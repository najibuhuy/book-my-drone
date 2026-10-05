import type {
  AssignedPilot,
  Availability,
  Booking,
  BookingInput,
  DailyProgress,
  DailyProgressInput,
  Drone,
  DronePilotHistory,
  DroneStatus,
  DroneType,
  DroneTypeStat,
  Pilot,
  Summary,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Bookings
  listBookings: (range?: { start?: string; end?: string }) => {
    const params = new URLSearchParams();
    if (range?.start) params.set("start", range.start);
    if (range?.end) params.set("end", range.end);
    const qs = params.toString();
    return request<Booking[]>(`/bookings${qs ? `?${qs}` : ""}`);
  },
  getBooking: (id: string) => request<Booking>(`/bookings/${id}`),
  createBooking: (input: BookingInput) =>
    request<Booking>("/bookings", { method: "POST", body: JSON.stringify(input) }),
  updateBooking: (id: string, input: BookingInput) =>
    request<Booking>(`/bookings/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteBooking: (id: string) => request<void>(`/bookings/${id}`, { method: "DELETE" }),

  // Daily progress (per drone per day, area in HA)
  listDailyProgress: (bookingId: string) =>
    request<DailyProgress[]>(`/bookings/${bookingId}/daily-progress`),
  saveDailyProgress: (
    bookingId: string,
    entry: DailyProgressInput,
  ) =>
    request<DailyProgress>(`/bookings/${bookingId}/daily-progress`, {
      method: "POST",
      body: JSON.stringify(entry),
    }),
  deleteDailyProgress: (id: number) =>
    request<void>(`/daily-progress/${id}`, { method: "DELETE" }),

  // Drone types
  listDroneTypes: () => request<DroneType[]>("/drone-types"),
  createDroneType: (name: string) =>
    request<DroneType>("/drone-types", { method: "POST", body: JSON.stringify({ name }) }),
  updateDroneType: (id: number, name: string) =>
    request<DroneType>(`/drone-types/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteDroneType: (id: number) => request<void>(`/drone-types/${id}`, { method: "DELETE" }),

  // Drones (units + status)
  listDrones: () => request<Drone[]>("/drones"),
  createDrone: (code: string, drone_type: string, status: DroneStatus = "Standby") =>
    request<Drone>("/drones", {
      method: "POST",
      body: JSON.stringify({ code, drone_type, status }),
    }),
  updateDrone: (id: number, code: string, drone_type: string, status: DroneStatus) =>
    request<Drone>(`/drones/${id}`, {
      method: "PUT",
      body: JSON.stringify({ code, drone_type, status }),
    }),
  deleteDrone: (id: number) => request<void>(`/drones/${id}`, { method: "DELETE" }),

  // Availability (per unit) for a date window
  availability: (start: string, end: string, exclude?: string) => {
    const params = new URLSearchParams({ start, end });
    if (exclude) params.set("exclude", exclude);
    return request<Availability[]>(`/availability?${params.toString()}`);
  },

  // Pilots (names)
  listPilots: () => request<Pilot[]>("/pilots"),
  createPilot: (name: string) =>
    request<Pilot>("/pilots", { method: "POST", body: JSON.stringify({ name }) }),
  deletePilot: (id: number) => request<void>(`/pilots/${id}`, { method: "DELETE" }),

  // Pilots assigned to a drone within a booking (project-scoped, multi-pilot)
  assignDronePilot: (bookingId: string, drone_id: number, pilot_id: number) =>
    request<AssignedPilot>(`/bookings/${bookingId}/drone-pilots`, {
      method: "POST",
      body: JSON.stringify({ drone_id, pilot_id }),
    }),
  unassignDronePilot: (assignmentId: number) =>
    request<void>(`/booking-drone-pilots/${assignmentId}`, { method: "DELETE" }),

  // A drone's pilot history (derived from the projects it flew)
  dronePilotHistory: (droneId: number) =>
    request<DronePilotHistory[]>(`/drones/${droneId}/pilot-history`),

  // Performance summary for a date range
  summary: (start: string, end: string) =>
    request<Summary>(`/summary?${new URLSearchParams({ start, end }).toString()}`),

  // Stats
  stats: () => request<DroneTypeStat[]>("/stats"),
};
