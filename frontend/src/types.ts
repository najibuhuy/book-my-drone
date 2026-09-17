/** One drone-type line within a booking (a drone type + how many). */
export interface DroneLine {
  drone_type: string;
  number_of_drones: number;
}

export interface Booking {
  id: string;
  project_name: string;
  start_date: string; // ISO date (YYYY-MM-DD)
  end_date: string; // ISO date (YYYY-MM-DD)
  vendor_name: string;
  description: string;
  progress: number; // 0..100
  pic: string;
  drones: DroneLine[];
  total_drones: number;
  created_at: string;
  updated_at: string;
}

export interface BookingInput {
  project_name: string;
  start_date: string;
  end_date: string;
  vendor_name: string;
  description: string;
  progress: number;
  pic: string;
  drones: DroneLine[];
}

export interface DroneType {
  id: number;
  name: string;
  total_quantity: number;
  booked_today: number;
}

export interface DroneTypeStat {
  drone_type: string;
  bookings: number;
  total_drones: number;
}

/** Availability of a drone type within a specific date window. */
export interface Availability {
  drone_type: string;
  total_quantity: number;
  booked: number;
  available: number;
}
