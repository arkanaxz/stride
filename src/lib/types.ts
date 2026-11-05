export type Run = {
  id?: number;
  date: string;
  name: string;
  type: string;
  distance: number;
  duration: number;
  avgHr?: number | null;
  maxHr?: number | null;
  weatherStart?: string;
  weatherEnd?: string;
  weatherDuring?: string;
  weatherRoute?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  sleep?: number | null;
  pain?: number | null;
  painDuring?: string;
  painNext?: string;
  effort?: number | null;
  shoes?: string;
  notes?: string;
  analysis?: string;
  analysisHistory?: AnalysisReview[];
};

export type AnalysisReview = {
  id: string;
  createdAt: string;
  provider: Preferences["provider"];
  model: string;
  text: string;
};

export type Workout = {
  id?: string | number;
  week: number;
  phase?: string;
  day?: string;
  date: string;
  session: string;
  pace?: string;
  hr?: string;
  target?: string;
  strength?: string;
  notes?: string;
  itbNext?: string;
  status?: string;
  dateShiftable?: boolean;
};

export type Preferences = {
  defaultLocation: string;
  theme: "dark" | "light";
  raceDate: string;
  planRowCount: number;
  provider: "openai" | "gemini" | "anthropic";
  model: string;
  providerModels?: Partial<Record<"openai" | "gemini" | "anthropic", string>>;
  lthr?: number | null;
  notificationLeadHours?: number;
  notificationsEnabled?: boolean;
};

export type Bundle = {
  runs: Run[];
  plan: Workout[];
  meta: Record<string, string>;
  preferences: Preferences;
  storage?: "Turso" | "SQLite";
  user?: { username: string; role: "admin" | "viewer" };
  comments?: RunComment[];
  shoeMileageBase?: Record<string, number>;
};

export type RunComment = {
  id: number;
  runId: number;
  username: string;
  text: string;
  createdAt: string;
};
