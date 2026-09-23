/**
 * Device vocabulary, shared between the form, the filters and the validator.
 *
 * A plain module with no directive: in a `"use server"` file every export
 * becomes an action reference, so a const array exported from there reaches the
 * client as an opaque function and throws the first time anything maps over it.
 *
 * The values mirror the enums in `db/schema/devices.ts`; `check:devices`
 * asserts the two stay identical.
 */

export const DEVICE_KINDS = ["fingerprint", "face", "card", "mobile", "kiosk"] as const;
export const CONNECTIONS = ["tcp_ip", "usb", "serial", "cloud_api"] as const;
export const DIRECTIONS = ["in_only", "out_only", "alternating", "device_reported"] as const;
export const DEVICE_STATUSES = ["active", "inactive", "maintenance"] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type Connection = (typeof CONNECTIONS)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const KIND_LABEL: Record<string, string> = {
  fingerprint: "Fingerprint",
  face: "Face",
  card: "Card / RFID",
  mobile: "Mobile app",
  kiosk: "Web kiosk",
};

export const CONNECTION_LABEL: Record<string, string> = {
  tcp_ip: "TCP/IP",
  usb: "USB",
  serial: "Serial",
  cloud_api: "Cloud push",
};

/** Straight from the legacy `vwDevices` mapping, in words rather than integers. */
export const DIRECTION_LABEL: Record<string, string> = {
  in_only: "In only",
  out_only: "Out only",
  alternating: "Alternating in/out",
  device_reported: "As the device reports",
};

export const DIRECTION_HINT: Record<string, string> = {
  in_only: "Every reading is an arrival. One half of a turnstile pair.",
  out_only: "Every reading is a departure.",
  alternating: "First reading of the day is in, the last is out. The usual door reader.",
  device_reported: "Trust the in/out flag the reader sends with each reading.",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "In service",
  inactive: "Withdrawn",
  maintenance: "Under maintenance",
};
