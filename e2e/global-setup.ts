import { exigirFunciones } from './soporte/guardia'

// Antes de la primera prueba: las funciones edge de PILOTO_FUNCIONES tienen que estar servidas (`soporte/guardia.ts`).
export default async function globalSetup(): Promise<void> {
  await exigirFunciones()
}
