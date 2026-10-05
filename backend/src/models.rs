use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

pub const DRONE_STATUSES: [&str; 3] = ["Standby", "Operational", "Incomplete"];

fn default_status() -> String {
    "Standby".to_string()
}

// ---------------------------------------------------------------------------
// Drones (individual units, each with a unique code + status)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Drone {
    pub id: i32,
    pub code: String,
    pub drone_type: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct DroneInput {
    pub code: String,
    pub drone_type: String,
    #[serde(default = "default_status")]
    pub status: String,
}

impl DroneInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.code.trim().is_empty() {
            return Err("code is required".into());
        }
        if self.drone_type.trim().is_empty() {
            return Err("drone_type is required".into());
        }
        if !DRONE_STATUSES.contains(&self.status.as_str()) {
            return Err("status must be Standby, Operational, or Incomplete".into());
        }
        Ok(())
    }
}

/// A booked drone joined with its per-booking progress, for grouping.
#[derive(Debug, FromRow)]
pub struct BookedDroneRow {
    pub booking_id: Uuid,
    pub id: i32,
    pub code: String,
    pub drone_type: String,
    pub status: String,
    pub area_done_ha: f64,
}

/// A pilot assigned to a drone within a booking.
#[derive(Debug, Clone, Serialize)]
pub struct AssignedPilot {
    pub id: i32, // booking_drone_pilots.id (for unassigning)
    pub pilot_id: i32,
    pub name: String,
}

/// Row for grouping assigned pilots onto their (booking, drone).
#[derive(Debug, FromRow)]
pub struct AssignedPilotRow {
    pub booking_id: Uuid,
    pub drone_id: i32,
    pub id: i32,
    pub pilot_id: i32,
    pub name: String,
}

/// A drone as reserved by a booking: area completed there + pilots assigned.
#[derive(Debug, Serialize)]
pub struct BookedDrone {
    pub id: i32,
    pub code: String,
    pub drone_type: String,
    pub status: String,
    pub area_done_ha: f64,
    pub pilots: Vec<AssignedPilot>,
}

// ---------------------------------------------------------------------------
// Drone types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct DroneType {
    pub id: i32,
    pub name: String,
    pub total_units: i64,
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

pub const PROJECT_TYPES: [&str; 6] = [
    "Bagworm",
    "Foliar",
    "Oryctes",
    "Fertilizer",
    "Forestry",
    "Trial",
];

fn default_project_type() -> String {
    "Foliar".to_string()
}

fn default_qty_rotation() -> i32 {
    1
}

#[derive(Debug, FromRow)]
pub struct BookingBase {
    pub id: Uuid,
    pub project_name: String,
    pub project_type: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub vendor_name: String,
    pub description: String,
    pub area_to_cover_ha: f64,
    pub qty_rotation: i32,
    pub pic: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Full booking: base fields, the reserved drone units (with per-drone area),
/// the area to cover (× rotation = total), the area done, and derived progress %.
#[derive(Debug, Serialize)]
pub struct Booking {
    pub id: Uuid,
    pub project_name: String,
    pub project_type: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub vendor_name: String,
    pub description: String,
    pub area_to_cover_ha: f64,
    pub qty_rotation: i32,
    /// Derived: area_to_cover_ha × qty_rotation. Denominator for progress.
    pub total_area_ha: f64,
    pub area_done_ha: f64,
    pub progress: i32,
    pub pic: String,
    pub drones: Vec<BookedDrone>,
    pub total_drones: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Derive a 0..100 progress percentage from area completed vs total area.
pub fn compute_progress(area_done: f64, total_area: f64) -> i32 {
    if total_area <= 0.0 {
        return 0;
    }
    ((area_done / total_area) * 100.0).round().clamp(0.0, 100.0) as i32
}

impl Booking {
    pub fn from_parts(base: BookingBase, drones: Vec<BookedDrone>) -> Self {
        let area_done: f64 = drones.iter().map(|d| d.area_done_ha).sum();
        let total_area = base.area_to_cover_ha * base.qty_rotation as f64;
        Booking {
            id: base.id,
            project_name: base.project_name,
            project_type: base.project_type,
            start_date: base.start_date,
            end_date: base.end_date,
            vendor_name: base.vendor_name,
            description: base.description,
            area_to_cover_ha: base.area_to_cover_ha,
            qty_rotation: base.qty_rotation,
            total_area_ha: total_area,
            area_done_ha: area_done,
            progress: compute_progress(area_done, total_area),
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
    #[serde(default = "default_project_type")]
    pub project_type: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub vendor_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub area_to_cover_ha: f64,
    #[serde(default = "default_qty_rotation")]
    pub qty_rotation: i32,
    pub pic: String,
    pub drone_ids: Vec<i32>,
}

impl BookingInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.project_name.trim().is_empty() {
            return Err("project_name is required".into());
        }
        if !PROJECT_TYPES.contains(&self.project_type.as_str()) {
            return Err("project_type is not one of the allowed values".into());
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
        if self.area_to_cover_ha < 0.0 {
            return Err("area_to_cover_ha cannot be negative".into());
        }
        if self.qty_rotation < 1 {
            return Err("qty_rotation must be at least 1".into());
        }
        if self.drone_ids.is_empty() {
            return Err("select at least one drone".into());
        }
        Ok(())
    }

    pub fn unique_drone_ids(&self) -> Vec<i32> {
        let mut ids = self.drone_ids.clone();
        ids.sort_unstable();
        ids.dedup();
        ids
    }
}

// ---------------------------------------------------------------------------
// Daily progress (per drone per day, area in HA)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct DailyProgress {
    pub id: i32,
    pub drone_id: i32,
    pub code: String,
    pub entry_date: NaiveDate,
    pub area_ha: f64,
    pub pilot_id: Option<i32>,
    pub pilot_name: Option<String>,
    pub fail_reason: Option<String>,
}

pub const FAIL_REASONS: [&str; 6] = [
    "Cuaca",
    "Drone Issue",
    "Crash",
    "Genset Issue",
    "Access Issue",
    "Estate Issue",
];

#[derive(Debug, Deserialize)]
pub struct DailyProgressInput {
    pub drone_id: i32,
    pub entry_date: NaiveDate,
    pub area_ha: f64,
    /// Pilot who flew this log (must be assigned to the drone on this booking).
    #[serde(default)]
    pub pilot_id: Option<i32>,
    /// Set when the drone couldn't fly; one of FAIL_REASONS.
    #[serde(default)]
    pub fail_reason: Option<String>,
}

impl DailyProgressInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.area_ha < 0.0 {
            return Err("area_ha cannot be negative".into());
        }
        if let Some(r) = &self.fail_reason {
            if !FAIL_REASONS.contains(&r.as_str()) {
                return Err("fail_reason is not one of the allowed values".into());
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Performance summary (for a date range)
// ---------------------------------------------------------------------------

/// One daily log in the range, with everything needed to group it by drone,
/// project, or pilot.
#[derive(Debug, Serialize, FromRow)]
pub struct SummaryEntry {
    pub entry_date: NaiveDate,
    pub area_ha: f64,
    pub fail_reason: Option<String>,
    pub booking_id: Uuid,
    pub project_name: String,
    pub project_type: String,
    pub drone_id: i32,
    pub drone_code: String,
    pub drone_type: String,
    pub pilot_id: Option<i32>,
    pub pilot_name: Option<String>,
}

/// A project active in the range, with area done before / during the range so
/// progress at the start and end of the range can be computed.
#[derive(Debug, Serialize, FromRow)]
pub struct SummaryProject {
    pub booking_id: Uuid,
    pub project_name: String,
    pub project_type: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub total_area_ha: f64,
    pub area_before_ha: f64,
    pub area_in_range_ha: f64,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub entries: Vec<SummaryEntry>,
    pub projects: Vec<SummaryProject>,
}

// ---------------------------------------------------------------------------
// Pilots + per-drone assignment history
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct Pilot {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct PilotInput {
    pub name: String,
}

/// Assign a pilot to a drone within a booking.
#[derive(Debug, Deserialize)]
pub struct DronePilotInput {
    pub drone_id: i32,
    pub pilot_id: i32,
}

/// One entry of a drone's pilot history, derived from the bookings it flew.
#[derive(Debug, Serialize, FromRow)]
pub struct DronePilotHistory {
    pub id: i32,
    pub booking_id: Uuid,
    pub project_name: String,
    pub pilot_id: i32,
    pub pilot_name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
}

// ---------------------------------------------------------------------------
// Availability + stats
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct Availability {
    pub id: i32,
    pub code: String,
    pub drone_type: String,
    pub available: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct DroneTypeStat {
    pub drone_type: String,
    pub bookings: i64,
    pub total_drones: i64,
}

/// Group booked-drone rows by their booking id.
pub fn group_booked(rows: Vec<BookedDroneRow>) -> HashMap<Uuid, Vec<BookedDroneRow>> {
    let mut map: HashMap<Uuid, Vec<BookedDroneRow>> = HashMap::new();
    for r in rows {
        map.entry(r.booking_id).or_default().push(r);
    }
    map
}

/// Group assigned-pilot rows by (booking id, drone id).
pub fn group_pilots(rows: Vec<AssignedPilotRow>) -> HashMap<(Uuid, i32), Vec<AssignedPilot>> {
    let mut map: HashMap<(Uuid, i32), Vec<AssignedPilot>> = HashMap::new();
    for r in rows {
        map.entry((r.booking_id, r.drone_id)).or_default().push(AssignedPilot {
            id: r.id,
            pilot_id: r.pilot_id,
            name: r.name,
        });
    }
    map
}
