export interface ResultadoRegistro {
  estado: "existente" | "verificacion_pendiente" | "autenticado" | "error";
  error?: string;
  hasSession?: boolean;
  alreadyLoggedIn?: boolean;
  sessionUnavailable?: boolean;
  invalidInput?: boolean;
}
