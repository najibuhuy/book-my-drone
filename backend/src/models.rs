use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// One drone-type line within a booking (like a room-type line on a hotel
/// reservation): a drone type plus how many of them.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DroneLine {
    pub drone_type: String,
    pub number_of_drones: i32,
}

/// A drone line joined with its owning booking id, used to regroup lines onto
/// the bookings they belong to when listing.
#[derive(Debug, FromRow)]
pub struct DroneLineRow {
    pub booking_id: Uuid,
    pub drone_type: String,
    pub number_of_drones: i32,
}

/// A row from the `bookings` table (without its drone lines).
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

/// The full booking as returned by the API: base fields, its drone lines, and
/// the computed total number of drones across all lines.
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
    pub drones: Vec<DroneLine>,
    pub total_drones: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Booking {
    pub fn from_parts(base: BookingBase, drones: Vec<DroneLine>) -> Self {
        let total_drones = drones.iter().map(|d| d.number_of_drones).sum();
        Booking {
            id: base.id,
            project_name: base.project_name,
            start_date: base.start_date,
            end_date: base.end_date,
            vendor_name: base.vendor_name,
            description: base.description,
            progress: base.progress,
            pic: base.pic,
            drones,
            total_drones,
            created_at: base.created_at,
            updated_at: base.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct DroneLineInput {
    pub drone_type: String,
    pub number_of_drones: i32,
}

/// Payload accepted for creating or updating a booking.
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
    pub drones: Vec<DroneLineInput>,
}

impl BookingInput {
    /// Validate business rules. Returns a user-facing message on first violation.
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
        if self.drones.is_empty() {
            return Err("at least one drone type is required".into());
        }
        for d in &self.drones {
            if d.drone_type.trim().is_empty() {
                return Err("each drone line needs a drone_type".into());
            }
            if d.number_of_drones < 1 {
                return Err("each drone line needs number_of_drones of at least 1".into());
            }
        }
        Ok(())
    }
}

/// A configurable drone type plus its stock. `booked_today` is how many are
/// committed to bookings overlapping the current date (a convenience snapshot
/// for the Stock page).
#[derive(Debug, Serialize, FromRow)]
pub struct DroneType {
    pub id: i32,
    pub name: String,
    pub total_quantity: i32,
    pub booked_today: i64,
}

#[derive(Debug, Deserialize)]
pub struct DroneTypeInput {
    pub name: String,
    #[serde(default)]
    pub total_quantity: i32,
}

impl DroneTypeInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("name is required".into());
        }
        if self.total_quantity < 0 {
            return Err("total_quantity cannot be negative".into());
        }
        Ok(())
    }
}

/// Per-type availability for a given date window: how many exist, how many are
/// already booked in overlapping bookings, and how many remain free.
#[derive(Debug, Serialize, FromRow)]
pub struct Availability {
    pub drone_type: String,
    pub total_quantity: i32,
    pub booked: i64,
    pub available: i64,
}

/// Aggregated drone usage per drone type, used by the dashboard chart.
#[derive(Debug, Serialize, FromRow)]
pub struct DroneTypeStat {
    pub drone_type: String,
    pub bookings: i64,
    pub total_drones: i64,
}

/// Group drone-line rows by their booking id.
pub fn group_lines(rows: Vec<DroneLineRow>) -> HashMap<Uuid, Vec<DroneLine>> {
    let mut map: HashMap<Uuid, Vec<DroneLine>> = HashMap::new();
    for r in rows {
        map.entry(r.booking_id).or_default().push(DroneLine {
            drone_type: r.drone_type,
            number_of_drones: r.number_of_drones,
        });
    }
    map
}
