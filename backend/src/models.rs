use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Drones (individual units, each with a unique code)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Drone {
    pub id: i32,
    pub code: String,
    pub drone_type: String,
}

#[derive(Debug, Deserialize)]
pub struct DroneInput {
    pub code: String,
    pub drone_type: String,
}

impl DroneInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.code.trim().is_empty() {
            return Err("code is required".into());
        }
        if self.drone_type.trim().is_empty() {
            return Err("drone_type is required".into());
        }
        Ok(())
    }
}

/// A booked drone unit joined with the booking it belongs to (for grouping).
#[derive(Debug, FromRow)]
pub struct BookedDroneRow {
    pub booking_id: Uuid,
    pub id: i32,
    pub code: String,
    pub drone_type: String,
}

// ---------------------------------------------------------------------------
// Drone types (categories) — quantities are now derived from `drones`
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct DroneType {
    pub id: i32,
    pub name: String,
    /// Number of drones (units) of this type the company owns.
    pub total_units: i64,
    /// Units of this type committed to bookings overlapping the current date.
    pub booked_today: i64,
}

#[derive(Debug, Deserialize)]
pub struct DroneTypeInput {
    pub name: String,
}

impl DroneTypeInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("name is required".into());
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

#[derive(Debug, FromRow)]
pub struct BookingBase {
    pub id: Uuid,
    pub project_name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub vendor_name: String,
    pub description: String,
    pub progress: i32,
    pub pic: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Full booking as returned by the API: base fields + the specific drone units
/// reserved + a total count.
#[derive(Debug, Serialize)]
pub struct Booking {
    pub id: Uuid,
    pub project_name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub vendor_name: String,
    pub description: String,
    pub progress: i32,
    pub pic: String,
    pub drones: Vec<Drone>,
    pub total_drones: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Booking {
    pub fn from_parts(base: BookingBase, drones: Vec<Drone>) -> Self {
        Booking {
            id: base.id,
            project_name: base.project_name,
            start_date: base.start_date,
            end_date: base.end_date,
            vendor_name: base.vendor_name,
            description: base.description,
            progress: base.progress,
            pic: base.pic,
            total_drones: drones.len() as i32,
            drones,
            created_at: base.created_at,
            updated_at: base.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct BookingInput {
    pub project_name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub vendor_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub progress: i32,
    pub pic: String,
    /// Specific drone units to reserve.
    pub drone_ids: Vec<i32>,
}

impl BookingInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.project_name.trim().is_empty() {
            return Err("project_name is required".into());
        }
        if self.vendor_name.trim().is_empty() {
            return Err("vendor_name is required".into());
        }
        if self.pic.trim().is_empty() {
            return Err("pic is required".into());
        }
        if self.end_date < self.start_date {
            return Err("end_date must be on or after start_date".into());
        }
        if !(0..=100).contains(&self.progress) {
            return Err("progress must be between 0 and 100".into());
        }
        if self.drone_ids.is_empty() {
            return Err("select at least one drone".into());
        }
        Ok(())
    }

    /// Deduplicated, sorted drone ids (stable lock order, no double-count).
    pub fn unique_drone_ids(&self) -> Vec<i32> {
        let mut ids = self.drone_ids.clone();
        ids.sort_unstable();
        ids.dedup();
        ids
    }
}

// ---------------------------------------------------------------------------
// Availability + stats
// ---------------------------------------------------------------------------

/// A drone unit and whether it is free for a requested date window.
#[derive(Debug, Serialize, FromRow)]
pub struct Availability {
    pub id: i32,
    pub code: String,
    pub drone_type: String,
    pub available: bool,
}

/// Aggregated usage per drone type, used by the dashboard chart.
#[derive(Debug, Serialize, FromRow)]
pub struct DroneTypeStat {
    pub drone_type: String,
    pub bookings: i64,
    pub total_drones: i64,
}

/// Group booked-drone rows by their booking id.
pub fn group_booked(rows: Vec<BookedDroneRow>) -> HashMap<Uuid, Vec<Drone>> {
    let mut map: HashMap<Uuid, Vec<Drone>> = HashMap::new();
    for r in rows {
        map.entry(r.booking_id).or_default().push(Drone {
            id: r.id,
            code: r.code,
            drone_type: r.drone_type,
        });
    }
    map
}
