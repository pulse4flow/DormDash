export type StaffRole = "MANAGER" | "STAFF";
export type ReservationStatus = "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
export type WorkStatus = "OPEN" | "IN_PROGRESS" | "DONE";

export type OperationsRoom = {
  id: string; number: string; type: string; capacity: number;
  clean: boolean; outOfService: boolean;
};
export type OperationsReservation = {
  id: string; roomId: string; guestName: string; guestContact: string;
  checkIn: string; checkOut: string; partySize: number; notes: string;
  status: ReservationStatus; checkedInAt: string | null; checkedOutAt: string | null;
};
export type OperationsWorkOrder = {
  id: string; roomId: string; type: "HOUSEKEEPING" | "REPAIR";
  title: string; status: WorkStatus; assigneeId: string | null;
  blocksRoom: boolean; createdAt: string;
};
export type OperationsStaff = { id: string; name: string; email: string; role: StaffRole };
export type OperationsSnapshot = {
  user: OperationsStaff;
  property: { id: string; name: string; timezone: string };
  currentDate: string;
  rooms: OperationsRoom[];
  reservations: OperationsReservation[];
  workOrders: OperationsWorkOrder[];
  staff: OperationsStaff[];
};

export type OperationsAction =
  | { action: "createRoom"; number: string; type: string; capacity: number }
  | { action: "updateRoom"; id: string; number: string; type: string; capacity: number; outOfService: boolean }
  | { action: "createReservation"; roomId: string; guestName: string; guestContact: string; checkIn: string; checkOut: string; partySize: number; notes: string }
  | { action: "updateReservation"; id: string; roomId: string; guestName: string; guestContact: string; checkIn: string; checkOut: string; partySize: number; notes: string }
  | { action: "cancelReservation"; id: string }
  | { action: "checkIn"; id: string }
  | { action: "checkOut"; id: string }
  | { action: "createWorkOrder"; roomId: string; type: "HOUSEKEEPING" | "REPAIR"; title: string; assigneeId: string | null; blocksRoom: boolean }
  | { action: "updateWorkOrder"; id: string; status: WorkStatus; assigneeId: string | null }
  | { action: "updateProperty"; name: string }
  | { action: "createStaff"; name: string; email: string; password: string; role: StaffRole };

// GET /api/operations returns OperationsSnapshot. POST accepts OperationsAction,
// returns { ok: true }; clients then reload GET. Errors use { error: string }.
// Session POST: {email,password}; DELETE: logout. Setup POST:
// {registrationKey,propertyName,timezone,name,email,password}; creates manager + session.
