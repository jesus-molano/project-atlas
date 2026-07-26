export type DisplayDensity = "compact" | "comfortable";

export interface SettingsPayload {
  changed: boolean;
}

export interface SettingsFormProps {
  accountId: string;
  density?: DisplayDensity;
  label?: string;
  locked?: boolean;
}

export interface SettingsFormEvents {
  (event: "save", payload: SettingsPayload): void;
  (event: "cancel"): void;
  validated: [valid: boolean];
}
