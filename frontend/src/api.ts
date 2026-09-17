import type {
  Availability,
  Booking,
  BookingInput,
  DroneType,
  DroneTypeStat,
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
    request<Booking>("/bookings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateBooking: (id: string, input: BookingInput) =>
    request<Booking>(`/bookings/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteBooking: (id: string) =>
    request<void>(`/bookings/${id}`, { method: "DELETE" }),

  // Drone types + stock (Stock page)
  listDroneTypes: () => request<DroneType[]>("/drone-types"),
  createDroneType: (name: string, total_quantity: number) =>
    request<DroneType>("/drone-types", {
      method: "POST",
      body: JSON.stringify({ name, total_quantity }),
    }),
  updateDroneType: (id: number, name: string, total_quantity: number) =>
    request<DroneType>(`/drone-types/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, total_quantity }),
    }),
  deleteDroneType: (id: number) =>
    request<void>(`/drone-types/${id}`, { method: "DELETE" }),

  // Availability for a date window (drives live feedback in the booking form)
  availability: (start: string, end: string, exclude?: string) => {
    const params = new URLSearchParams({ start, end });
    if (exclude) params.set("exclude", exclude);
    return request<Availability[]>(`/availability?${params.toString()}`);
  },

  // Stats
  stats: () => request<DroneTypeStat[]>("/stats"),
};
