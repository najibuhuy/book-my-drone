use std::collections::BTreeMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{
    group_lines, Availability, Booking, BookingBase, BookingInput, DroneLine, DroneLineInput,
    DroneLineRow, DroneType, DroneTypeInput, DroneTypeStat,
};
use crate::AppState;

/// UUID used to mean "exclude no booking" in overlap queries (create has no id
/// yet, and no real booking will ever carry the nil UUID).
const NIL_UUID: Uuid = Uuid::nil();

pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

// ---------------------------------------------------------------------------
// Drone types (configurable list backing the booking form dropdown)
// ---------------------------------------------------------------------------

/// Base SELECT for a drone type with its `booked_today` snapshot.
const DRONE_TYPE_SELECT: &str = "SELECT dt.id, dt.name, dt.total_quantity,
        COALESCE((SELECT SUM(bd.number_of_drones)
                  FROM booking_drones bd JOIN bookings b ON b.id = bd.booking_id
                  WHERE bd.drone_type = dt.name
                    AND b.start_date <= CURRENT_DATE AND b.end_date >= CURRENT_DATE), 0)::bigint
            AS booked_today
     FROM drone_types dt";

pub async fn list_drone_types(
    State(state): State<AppState>,
) -> Result<Json<Vec<DroneType>>, AppError> {
    let rows = sqlx::query_as::<_, DroneType>(&format!("{DRONE_TYPE_SELECT} ORDER BY dt.name"))
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

pub async fn create_drone_type(
    State(state): State<AppState>,
    Json(input): Json<DroneTypeInput>,
) -> Result<(StatusCode, Json<DroneType>), AppError> {
    input.validate().map_err(AppError::Validation)?;
    let name = input.name.trim();
    // Create-only: a duplicate name is a conflict, not a silent overwrite.
    let id: i32 = match sqlx::query_scalar(
        "INSERT INTO drone_types (name, total_quantity) VALUES ($1, $2) RETURNING id",
    )
    .bind(name)
    .bind(input.total_quantity)
    .fetch_one(&state.pool)
    .await
    {
        Ok(id) => id,
        Err(e) if is_unique_violation(&e) => {
            return Err(AppError::Conflict(format!(
                "A drone type named \"{name}\" already exists"
            )))
        }
        Err(e) => return Err(e.into()),
    };
    let row = fetch_drone_type(&state.pool, id).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_drone_type(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(input): Json<DroneTypeInput>,
) -> Result<Json<DroneType>, AppError> {
    input.validate().map_err(AppError::Validation)?;
    let name = input.name.trim();
    // Renaming cascades to booking_drones via the FK (ON UPDATE CASCADE), so
    // stock accounting stays consistent. A clash with another type's name is a
    // conflict.
    let updated: Option<i32> = match sqlx::query_scalar(
        "UPDATE drone_types SET name = $2, total_quantity = $3 WHERE id = $1 RETURNING id",
    )
    .bind(id)
    .bind(name)
    .bind(input.total_quantity)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(o) => o,
        Err(e) if is_unique_violation(&e) => {
            return Err(AppError::Conflict(format!(
                "A drone type named \"{name}\" already exists"
            )))
        }
        Err(e) => return Err(e.into()),
    };
    if updated.is_none() {
        return Err(AppError::NotFound("drone type not found".into()));
    }
    let row = fetch_drone_type(&state.pool, id).await?;
    Ok(Json(row))
}

pub async fn delete_drone_type(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    // The FK (ON DELETE RESTRICT) blocks deleting a type that bookings still
    // reference; surface that as a friendly conflict instead of a 500.
    let result = match sqlx::query("DELETE FROM drone_types WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await
    {
        Ok(r) => r,
        Err(e) if is_fk_violation(&e) => {
            return Err(AppError::Conflict(
                "Can't delete this drone type — it's used by existing bookings.".into(),
            ))
        }
        Err(e) => return Err(e.into()),
    };
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("drone type not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_drone_type(pool: &sqlx::PgPool, id: i32) -> Result<DroneType, sqlx::Error> {
    sqlx::query_as::<_, DroneType>(&format!("{DRONE_TYPE_SELECT} WHERE dt.id = $1"))
        .bind(id)
        .fetch_one(pool)
        .await
}

/// Postgres unique-violation (SQLSTATE 23505).
fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23505")
}

/// Postgres foreign-key-violation (SQLSTATE 23503).
fn is_fk_violation(e: &sqlx::Error) -> bool {
    e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23503")
}

/// Per-type availability for a date window (drives live feedback in the form).
#[derive(Debug, Deserialize)]
pub struct AvailabilityQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
    /// Optional booking to ignore (so editing a booking doesn't count itself).
    pub exclude: Option<Uuid>,
}

pub async fn availability(
    State(state): State<AppState>,
    Query(q): Query<AvailabilityQuery>,
) -> Result<Json<Vec<Availability>>, AppError> {
    if q.end < q.start {
        return Err(AppError::Validation("end must be on or after start".into()));
    }
    let rows = sqlx::query_as::<_, Availability>(
        "SELECT dt.name AS drone_type,
                dt.total_quantity,
                COALESCE(b.n, 0)::bigint                        AS booked,
                (dt.total_quantity - COALESCE(b.n, 0))::bigint  AS available
         FROM drone_types dt
         LEFT JOIN (
             SELECT bd.drone_type, SUM(bd.number_of_drones) AS n
             FROM booking_drones bd JOIN bookings bk ON bk.id = bd.booking_id
             WHERE bk.start_date <= $2 AND bk.end_date >= $1 AND bk.id <> $3
             GROUP BY bd.drone_type
         ) b ON b.drone_type = dt.name
         ORDER BY dt.name",
    )
    .bind(q.start)
    .bind(q.end)
    .bind(q.exclude.unwrap_or(NIL_UUID))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

const BOOKING_COLUMNS: &str =
    "id, project_name, start_date, end_date, vendor_name, description, progress, pic, created_at, updated_at";

/// Optional date-range filter. Returns bookings that overlap [start, end].
#[derive(Debug, Deserialize)]
pub struct BookingQuery {
    pub start: Option<NaiveDate>,
    pub end: Option<NaiveDate>,
}

pub async fn list_bookings(
    State(state): State<AppState>,
    Query(q): Query<BookingQuery>,
) -> Result<Json<Vec<Booking>>, AppError> {
    let bases = sqlx::query_as::<_, BookingBase>(&format!(
        "SELECT {BOOKING_COLUMNS} FROM bookings
         WHERE ($1::date IS NULL OR end_date >= $1)
           AND ($2::date IS NULL OR start_date <= $2)
         ORDER BY start_date, project_name"
    ))
    .bind(q.start)
    .bind(q.end)
    .fetch_all(&state.pool)
    .await?;

    if bases.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let ids: Vec<Uuid> = bases.iter().map(|b| b.id).collect();
    let lines = sqlx::query_as::<_, DroneLineRow>(
        "SELECT booking_id, drone_type, number_of_drones
         FROM booking_drones
         WHERE booking_id = ANY($1)
         ORDER BY id",
    )
    .bind(&ids)
    .fetch_all(&state.pool)
    .await?;

    let mut grouped = group_lines(lines);
    let bookings = bases
        .into_iter()
        .map(|b| {
            let drones = grouped.remove(&b.id).unwrap_or_default();
            Booking::from_parts(b, drones)
        })
        .collect();

    Ok(Json(bookings))
}

pub async fn get_booking(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Booking>, AppError> {
    let base = sqlx::query_as::<_, BookingBase>(&format!(
        "SELECT {BOOKING_COLUMNS} FROM bookings WHERE id = $1"
    ))
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    let drones = fetch_lines(&state.pool, id).await?;
    Ok(Json(Booking::from_parts(base, drones)))
}

pub async fn create_booking(
    State(state): State<AppState>,
    Json(input): Json<BookingInput>,
) -> Result<(StatusCode, Json<Booking>), AppError> {
    input.validate().map_err(AppError::Validation)?;

    let mut tx = state.pool.begin().await?;

    let base = sqlx::query_as::<_, BookingBase>(&format!(
        "INSERT INTO bookings
            (project_name, start_date, end_date, vendor_name, description, progress, pic)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING {BOOKING_COLUMNS}"
    ))
    .bind(input.project_name.trim())
    .bind(input.start_date)
    .bind(input.end_date)
    .bind(input.vendor_name.trim())
    .bind(input.description.trim())
    .bind(input.progress)
    .bind(input.pic.trim())
    .fetch_one(&mut *tx)
    .await?;

    // Enforce stock for the booking window before committing any lines.
    check_stock(&mut tx, base.id, input.start_date, input.end_date, &input.drones).await?;
    let drones = insert_lines(&mut tx, base.id, &input.drones).await?;
    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(Booking::from_parts(base, drones))))
}

pub async fn update_booking(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(input): Json<BookingInput>,
) -> Result<Json<Booking>, AppError> {
    input.validate().map_err(AppError::Validation)?;

    let mut tx = state.pool.begin().await?;

    let base = sqlx::query_as::<_, BookingBase>(&format!(
        "UPDATE bookings SET
            project_name = $2,
            start_date = $3,
            end_date = $4,
            vendor_name = $5,
            description = $6,
            progress = $7,
            pic = $8,
            updated_at = now()
         WHERE id = $1
         RETURNING {BOOKING_COLUMNS}"
    ))
    .bind(id)
    .bind(input.project_name.trim())
    .bind(input.start_date)
    .bind(input.end_date)
    .bind(input.vendor_name.trim())
    .bind(input.description.trim())
    .bind(input.progress)
    .bind(input.pic.trim())
    .fetch_one(&mut *tx)
    .await?;

    // Replace all drone lines with the submitted set. Old lines are removed
    // first, then availability is re-checked (excluding this booking) before
    // the new lines go in.
    sqlx::query("DELETE FROM booking_drones WHERE booking_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    check_stock(&mut tx, id, input.start_date, input.end_date, &input.drones).await?;
    let drones = insert_lines(&mut tx, id, &input.drones).await?;

    tx.commit().await?;
    Ok(Json(Booking::from_parts(base, drones)))
}

pub async fn delete_booking(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    // booking_drones rows are removed via ON DELETE CASCADE.
    let result = sqlx::query("DELETE FROM bookings WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("booking not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Stats (drone usage per type — drives the dashboard chart)
// ---------------------------------------------------------------------------

pub async fn stats(
    State(state): State<AppState>,
) -> Result<Json<Vec<DroneTypeStat>>, AppError> {
    let rows = sqlx::query_as::<_, DroneTypeStat>(
        "SELECT drone_type,
                COUNT(DISTINCT booking_id)          AS bookings,
                COALESCE(SUM(number_of_drones), 0)  AS total_drones
         FROM booking_drones
         GROUP BY drone_type
         ORDER BY total_drones DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn fetch_lines(pool: &sqlx::PgPool, booking_id: Uuid) -> Result<Vec<DroneLine>, sqlx::Error> {
    sqlx::query_as::<_, DroneLine>(
        "SELECT drone_type, number_of_drones FROM booking_drones WHERE booking_id = $1 ORDER BY id",
    )
    .bind(booking_id)
    .fetch_all(pool)
    .await
}

/// Insert the given drone lines for a booking inside a transaction, returning
/// them (trimmed) for the API response.
async fn insert_lines(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
    lines: &[crate::models::DroneLineInput],
) -> Result<Vec<DroneLine>, sqlx::Error> {
    let mut out = Vec::with_capacity(lines.len());
    for line in lines {
        let drone_type = line.drone_type.trim().to_string();
        sqlx::query(
            "INSERT INTO booking_drones (booking_id, drone_type, number_of_drones)
             VALUES ($1, $2, $3)",
        )
        .bind(booking_id)
        .bind(&drone_type)
        .bind(line.number_of_drones)
        .execute(&mut **tx)
        .await?;
        out.push(DroneLine {
            drone_type,
            number_of_drones: line.number_of_drones,
        });
    }
    Ok(out)
}

/// Within a transaction, verify that every requested drone type has enough
/// stock free during [start, end], counting only OVERLAPPING bookings (the
/// hotel-room model). Locks each drone-type row (`FOR UPDATE`) so two
/// concurrent bookings can't both slip past the check. Returns a `Conflict`
/// (409) naming the first shortfall, which rolls back the transaction.
async fn check_stock(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    exclude_booking: Uuid,
    start: NaiveDate,
    end: NaiveDate,
    lines: &[DroneLineInput],
) -> Result<(), AppError> {
    // Aggregate requested counts per type; BTreeMap gives a stable lock order.
    let mut requested: BTreeMap<String, i64> = BTreeMap::new();
    for line in lines {
        *requested
            .entry(line.drone_type.trim().to_string())
            .or_default() += line.number_of_drones as i64;
    }

    for (drone_type, qty) in requested {
        let total: Option<i32> =
            sqlx::query_scalar("SELECT total_quantity FROM drone_types WHERE name = $1 FOR UPDATE")
                .bind(&drone_type)
                .fetch_optional(&mut **tx)
                .await?;
        let total = match total {
            Some(t) => t as i64,
            None => {
                return Err(AppError::Conflict(format!(
                    "Unknown drone type \"{drone_type}\" — add it on the Stock page first"
                )))
            }
        };

        let booked: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(bd.number_of_drones), 0)
             FROM booking_drones bd JOIN bookings b ON b.id = bd.booking_id
             WHERE bd.drone_type = $1
               AND b.start_date <= $3 AND b.end_date >= $2
               AND b.id <> $4",
        )
        .bind(&drone_type)
        .bind(start)
        .bind(end)
        .bind(exclude_booking)
        .fetch_one(&mut **tx)
        .await?;

        let available = total - booked;
        if available < qty {
            return Err(AppError::Conflict(format!(
                "Not enough \"{drone_type}\" for {start} to {end}: {available} available, {qty} requested"
            )));
        }
    }
    Ok(())
}
