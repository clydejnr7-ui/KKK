export interface UserSession {
  step: FormStep;
  platform?: "MT4" | "MT5";
  brokerName?: string;
  accountNumber?: string;
  password?: string;
  investorPassword?: string;
  serverName?: string;
  depositAmount?: string;
  startDate?: string;
  fullName?: string;
  email?: string;
}

export type FormStep =
  | "idle"
  | "platform"
  | "broker"
  | "account_number"
  | "password"
  | "investor_password"
  | "server_name"
  | "deposit"
  | "full_name"
  | "email"
  | "confirm";

export interface SessionData {
  [key: number]: UserSession;
}
