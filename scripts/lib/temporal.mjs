// Las carpetas temporales de las pruebas de `node --test`: cada una se borra al terminar las pruebas del archivo que la creó. El
// temporal del sistema suele ser un tmpfs con tope de archivos que comparten todos los proyectos de la máquina: lo que una prueba
// deja ahí se acumula corrida tras corrida hasta trabar a los demás. (Las de Vitest borran lo suyo en `afterAll`.)
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

const creadas = []

after(() => {
  for (const c of creadas.splice(0))
    rmSync(c, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Una carpeta nueva y vacía en el temporal del sistema (`<prefijo>XXXXXX`), que se borra al terminar el archivo de pruebas. */
export function carpetaTemporal(prefijo) {
  const c = mkdtempSync(join(tmpdir(), prefijo))
  creadas.push(c)
  return c
}
