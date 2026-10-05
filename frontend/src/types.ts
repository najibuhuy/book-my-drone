export type DroneStatus = "Standby" | "Operational" | "Incomplete";

/** An individual drone unit with a unique code and status. */
export interface Drone {
  id: number;
  code: string;
  drone_type: string;
  status: DroneStatus;
}

/** A pilot assigned to a drone within a booking. */
export interface AssignedPilot {
  id: number; // assignment id (for unassigning)
  pilot_id: number;
  name: string;
}

/** A drone as reserved by a booking, with its area completed + pilots. */
export interface BookedDrone {
  id: number;
  code: string;
  drone_type: string;
  status: DroneStatus;
  area_done_ha: number;
  pilots: AssignedPilot[];
}

export type ProjectType =
  | "Bagworm"
  | "Foliar"
  | "Oryctes"
  | "Fertilizer"
  | "Forestry"
  | "Trial";

export const PROJECT_TYPES: ProjectType[] = [
  "Bagworm",
  "Foliar",
  "Oryctes",
  "Fertilizer",
  "Forestry",
  "Trial",
];

export interface Booking {
  id: string;
  project_name: string;
  project_type: ProjectType;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  vendor_name: string;
  description: string;
  area_to_cover_ha: number;
  qty_rotation: number;
  total_area_ha: number; // derived = area_to_cover_ha × qty_rotation
  area_done_ha: number;
  progress: number; // derived 0..100
  pic: string;
  drones: BookedDrone[];
  total_drones: number;
  created_at: string;
  updated_at: string;
}

export interface BookingInput {
  project_name: string;
  project_type: ProjectType;
  start_date: string;
  end_date: string;
  vendor_name: string;
  description: string;
  area_to_cover_ha: number;
  qty_rotation: number;
  pic: string;
  drone_ids: number[];
}

export interface DroneType {
  id: number;
  name: string;
  total_units: number;
  booked_today: number;
}

export interface DroneTypeStat {
  drone_type: string;
  bookings: number;
  total_drones: number;
}

export interface Availability {
  id: number;
  code: string;
  drone_type: string;
  available: boolean;
}

/** A per-drone daily area log within a booking. */
export type FailReason =
  | "Cuaca"
  | "Drone Issue"
  | "Crash"
  | "Genset Issue"
  | "Access Issue"
  | "Estate Issue";

export const FAIL_REASONS: FailReason[] = [
  "Cuaca",
  "Drone Issue",
  "Crash",
  "Genset Issue",
  "Access Issue",
  "Estate Issue",
];

export interface DailyProgress {
  id: number;
  drone_id: number;
  code: string;
  entry_date: string; // YYYY-MM-DD
  area_ha: number;
  pilot_id: number | null;
  pilot_name: string | null;
  fail_reason: FailReason | null;
}

export interface DailyProgressInput {
  drone_id: number;
  entry_date: string;
  area_ha: number;
  pilot_id: number | null;
  fail_reason: FailReason | null;
}

/** One daily log within a summary range. */
export interface SummaryEntry {
  entry_date: string;
  area_ha: number;
  fail_reason: FailReason | null;
  booking_id: string;
  project_name: string;
  project_type: ProjectType;
  drone_id: number;
  drone_code: string;
  drone_type: string;
  pilot_id: number | null;
  pilot_name: string | null;
}

/** A project active in a summary range (area before / during the range). */
export interface SummaryProject {
  booking_id: string;
  project_name: string;
  project_type: ProjectType;
  start_date: string;
  end_date: string;
  total_area_ha: number;
  area_before_ha: number;
  area_in_range_ha: number;
}

export interface Summary {
  entries: SummaryEntry[];
  projects: SummaryProject[];
}

export interface Pilot {
  id: number;
  name: string;
}

/** One entry of a drone's pilot history, derived from the projects it flew. */
export interface DronePilotHistory {
  id: number;
  booking_id: string;
  project_name: string;
  pilot_id: number;
  pilot_name: string;
  start_date: string;
  end_date: string;
}
