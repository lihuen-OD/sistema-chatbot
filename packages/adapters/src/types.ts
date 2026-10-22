// Tipos compartidos del paquete, sin lógica. Separados de los guardas para que la
// configuración (config.ts) pueda usarlos sin importar `process.env`.

export const LOCAL_ADAPTER_ENVIRONMENTS = ["development", "test"] as const;
export type LocalAdapterEnvironment = (typeof LOCAL_ADAPTER_ENVIRONMENTS)[number];
