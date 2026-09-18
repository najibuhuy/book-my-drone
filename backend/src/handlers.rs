use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{
    group_booked, Availability, BookedDroneRow, Booking, BookingBase, BookingInput, Drone,
    DroneInput, DroneType, DroneTypeInput, DroneTypeStat,
};
use crate::AppState;

/// Sentinel used to mean "exclude no booking" in overlap queries.
const NIL_UUID: Uuid = Uuid::nil();

pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

// ---------------------------------------------------------------------------
// Drone types (categories)
// ---------------------------------------------------------------------------

const DRONE_TYPE_SELECT: &str = "SELECT dt.id, dt.name,
        (SELECT COUNT(*) FROM drones d WHERE d.drone_type = dt.name)::bigint AS total_units,
        (SELECT COUNT(*)
           FROM booking_drone_units bdu
           JOIN drones d ON d.id = bdu.drone_id
           JOIN bookings b ON b.id = bdu.booking_id
          WHERE d.drone_type = dt.name
            AND b.start_date <= CURRENT_DATE AND b.end_date >= CURRENT_DATE)::bigint AS booked_today
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
    let id: i32 = match sqlx::query_scalar("INSERT INTO drone_types (name) VALUES ($1) RETURNING id")
        .bind(name)
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
    Ok((StatusCode::CREATED, Json(fetch_drone_type(&state.pool, id).await?)))
}

pub async fn update_drone_type(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(input): Json<DroneTypeInput>,
) -> Result<Json<DroneType>, AppError> {
    input.validate().map_err(AppError::Validation)?;
    let name = input.name.trim();
    // Renaming cascades to drones.drone_type via the FK (ON UPDATE CASCADE).
    let updated: Option<i32> =
        match sqlx::query_scalar("UPDATE drone_types SET name = $2 WHERE id = $1 RETURNING id")
            .bind(id)
            .bind(name)
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
    Ok(Json(fetch_drone_type(&state.pool, id).await?))
}

pub async fn delete_drone_type(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let result = match sqlx::query("DELETE FROM drone_types WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await
    {
        Ok(r) => r,
        Err(e) if is_fk_violation(&e) => {
            return Err(AppError::Conflict(
                "Can't delete this type — it still has drones. Remove them first.".into(),
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

// ---------------------------------------------------------------------------
// Drones (individual units)
// ---------------------------------------------------------------------------

pub async fn list_drones(State(state): State<AppState>) -> Result<Json<Vec<Drone>>, AppError> {
    let rows =
        sqlx::query_as::<_, Drone>("SELECT id, code, drone_type FROM drones ORDER BY drone_type, code")
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(rows))
}

pub async fn create_drone(
    State(state): State<AppState>,
    Json(input): Json<DroneInput>,
) -> Result<(StatusCode, Json<Drone>), AppError> {
    input.validate().map_err(AppError::Validation)?;
    let row = match sqlx::query_as::<_, Drone>(
        "INSERT INTO drones (code, drone_type) VALUES ($1, $2) RETURNING id, code, drone_type",
    )
    .bind(input.code.trim())
    .bind(input.drone_type.trim())
    .fetch_one(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) if is_unique_violation(&e) => {
            return Err(AppError::Conflict(format!(
                "A drone with code \"{}\" already exists",
                input.code.trim()
            )))
        }
        Err(e) if is_fk_violation(&e) => {
            return Err(AppError::Conflict(format!(
                "Unknown drone type \"{}\" — add it first",
                input.drone_type.trim()
            )))
        }
        Err(e) => return Err(e.into()),
    };
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_drone(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(input): Json<DroneInput>,
) -> Result<Json<Drone>, AppError> {
    input.validate().map_err(AppError::Validation)?;
    let row = match sqlx::query_as::<_, Drone>(
        "UPDATE drones SET code = $2, drone_type = $3 WHERE id = $1 RETURNING id, code, drone_type",
    )
    .bind(id)
    .bind(input.code.trim())
    .bind(input.drone_type.trim())
    .fetch_optional(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) if is_unique_violation(&e) => {
            return Err(AppError::Conflict(format!(
                "A drone with code \"{}\" already exists",
                input.code.trim()
            )))
        }
        Err(e) if is_fk_violation(&e) => {
            return Err(AppError::Conflict(format!(
                "Unknown drone type \"{}\"",
                input.drone_type.trim()
            )))
        }
        Err(e) => return Err(e.into()),
    };
    match row {
        Some(r) => Ok(Json(r)),
        None => Err(AppError::NotFound("drone not found".into())),
    }
}

pub async fn delete_drone(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let result = match sqlx::query("DELETE FROM drones WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await
    {
        Ok(r) => r,
        Err(e) if is_fk_violation(&e) => {
            return Err(AppError::Conflict(
                "Can't delete this drone — it's reserved by a booking.".into(),
            ))
        }
        Err(e) => return Err(e.into()),
    };
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("drone not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Availability (per unit, for a date window)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AvailabilityQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
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
        "SELECT d.id, d.code, d.drone_type,
                NOT EXISTS (
                    SELECT 1 FROM booking_drone_units bdu
                    JOIN bookings b ON b.id = bdu.booking_id
                    WHERE bdu.drone_id = d.id
                      AND b.start_date <= $2 AND b.end_date >= $1
                      AND b.id <> $3
                ) AS available
         FROM drones d
         ORDER BY d.drone_type, d.code",
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
    let rows = sqlx::query_as::<_, BookedDroneRow>(
        "SELECT bdu.booking_id, d.id, d.code, d.drone_type
         FROM booking_drone_units bdu
         JOIN drones d ON d.id = bdu.drone_id
         WHERE bdu.booking_id = ANY($1)
         ORDER BY d.drone_type, d.code",
    )
    .bind(&ids)
    .fetch_all(&state.pool)
    .await?;

    let mut grouped = group_booked(rows);
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
    let drones = fetch_booked_drones(&state.pool, id).await?;
    Ok(Json(Booking::from_parts(base, drones)))
}

pub async fn create_booking(
    State(state): State<AppState>,
    Json(input): Json<BookingInput>,
) -> Result<(StatusCode, Json<Booking>), AppError> {
    input.validate().map_err(AppError::Validation)?;
    let ids = input.unique_drone_ids();

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

    reserve_units(&mut tx, base.id, input.start_date, input.end_date, &ids).await?;
    let drones = fetch_booked_drones_tx(&mut tx, base.id).await?;
    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(Booking::from_parts(base, drones))))
}

pub async fn update_booking(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(input): Json<BookingInput>,
) -> Result<Json<Booking>, AppError> {
    input.validate().map_err(AppError::Validation)?;
    let ids = input.unique_drone_ids();

    let mut tx = state.pool.begin().await?;
    let base = sqlx::query_as::<_, BookingBase>(&format!(
        "UPDATE bookings SET
            project_name = $2, start_date = $3, end_date = $4, vendor_name = $5,
            description = $6, progress = $7, pic = $8, updated_at = now()
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

    sqlx::query("DELETE FROM booking_drone_units WHERE booking_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    reserve_units(&mut tx, id, input.start_date, input.end_date, &ids).await?;
    let drones = fetch_booked_drones_tx(&mut tx, id).await?;
    tx.commit().await?;

    Ok(Json(Booking::from_parts(base, drones)))
}

pub async fn delete_booking(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
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
// Stats
// ---------------------------------------------------------------------------

pub async fn stats(State(state): State<AppState>) -> Result<Json<Vec<DroneTypeStat>>, AppError> {
    let rows = sqlx::query_as::<_, DroneTypeStat>(
        "SELECT d.drone_type,
                COUNT(DISTINCT bdu.booking_id) AS bookings,
                COUNT(*)                       AS total_drones
         FROM booking_drone_units bdu
         JOIN drones d ON d.id = bdu.drone_id
         GROUP BY d.drone_type
         ORDER BY total_drones DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn fetch_booked_drones(pool: &sqlx::PgPool, booking_id: Uuid) -> Result<Vec<Drone>, sqlx::Error> {
    sqlx::query_as::<_, Drone>(
        "SELECT d.id, d.code, d.drone_type
         FROM booking_drone_units bdu JOIN drones d ON d.id = bdu.drone_id
         WHERE bdu.booking_id = $1
         ORDER BY d.drone_type, d.code",
    )
    .bind(booking_id)
    .fetch_all(pool)
    .await
}

async fn fetch_booked_drones_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
) -> Result<Vec<Drone>, sqlx::Error> {
    sqlx::query_as::<_, Drone>(
        "SELECT d.id, d.code, d.drone_type
         FROM booking_drone_units bdu JOIN drones d ON d.id = bdu.drone_id
         WHERE bdu.booking_id = $1
         ORDER BY d.drone_type, d.code",
    )
    .bind(booking_id)
    .fetch_all(&mut **tx)
    .await
}

/// Reserve specific drone units for a booking, inside a transaction. Locks the
/// selected drone rows (`FOR UPDATE`) so two concurrent bookings can't grab the
/// same unit, verifies each exists and is free for the window (excluding this
/// booking), then inserts the assignments. Returns `Conflict` on any clash.
async fn reserve_units(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
    drone_ids: &[i32],
) -> Result<(), AppError> {
    // Lock the requested drone rows (stable order); confirms they all exist.
    let locked: Vec<i32> =
        sqlx::query_scalar("SELECT id FROM drones WHERE id = ANY($1) ORDER BY id FOR UPDATE")
            .bind(drone_ids)
            .fetch_all(&mut **tx)
            .await?;
    if locked.len() != drone_ids.len() {
        return Err(AppError::Validation("one or more drones do not exist".into()));
    }

    // Any requested unit already committed to an overlapping booking?
    let clashes: Vec<String> = sqlx::query_scalar(
        "SELECT d.code
         FROM drones d
         WHERE d.id = ANY($1)
           AND EXISTS (
               SELECT 1 FROM booking_drone_units bdu
               JOIN bookings b ON b.id = bdu.booking_id
               WHERE bdu.drone_id = d.id
                 AND b.start_date <= $3 AND b.end_date >= $2
                 AND b.id <> $4
           )
         ORDER BY d.code",
    )
    .bind(drone_ids)
    .bind(start)
    .bind(end)
    .bind(booking_id)
    .fetch_all(&mut **tx)
    .await?;
    if !clashes.is_empty() {
        return Err(AppError::Conflict(format!(
            "Already booked for {start} to {end}: {}",
            clashes.join(", ")
        )));
    }

    for drone_id in drone_ids {
        sqlx::query("INSERT INTO booking_drone_units (booking_id, drone_id) VALUES ($1, $2)")
            .bind(booking_id)
            .bind(drone_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

/// Postgres unique-violation (SQLSTATE 23505).
fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23505")
}

/// Postgres foreign-key-violation (SQLSTATE 23503).
fn is_fk_violation(e: &sqlx::Error) -> bool {
    e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23503")
}
