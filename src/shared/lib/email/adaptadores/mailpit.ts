import { fallo, ok } from '../../errores'
import { destinatarios, type AdaptadorDeEmail } from '../tipos'

// Mailpit, el correo local de Supabase (`[local_smtp]` de supabase/config.toml): su API de envío (`POST /api/v1/send`). Sirve para
// desarrollo y para los e2e, que leen lo que llegó en Mailpit. Otro proveedor es otro adaptador con el mismo contrato (`tipos.ts`).
export function crearAdaptadorMailpit(url: string, pedir: typeof fetch = fetch): AdaptadorDeEmail {
  const destino = `${url.replace(/\/+$/, '')}/api/v1/send`
  return async (mensaje, remitente) => {
    let respuesta: Response
    try {
      respuesta = await pedir(destino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: { Email: remitente.email, Name: remitente.nombre },
          To: destinatarios(mensaje.para).map((Email) => ({ Email })),
          Subject: mensaje.asunto,
          HTML: mensaje.html,
          Text: mensaje.texto,
          Tags: Object.entries(mensaje.etiquetas ?? {}).map(
            ([clave, valor]) => `${clave}:${valor}`,
          ),
        }),
      })
    } catch {
      return fallo('inesperado', 'El correo no salió: Mailpit no respondió.')
    }
    if (!respuesta.ok)
      return fallo(
        'inesperado',
        `El correo no salió: Mailpit respondió ${String(respuesta.status)}.`,
      )
    const cuerpo = (await respuesta.json().catch(() => null)) as { ID?: unknown } | null
    return typeof cuerpo?.ID === 'string'
      ? ok({ id: cuerpo.ID })
      : fallo('inesperado', 'Mailpit no devolvió el id del correo.')
  }
}
