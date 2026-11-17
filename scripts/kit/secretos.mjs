// Lo que no se publica: un archivo de entorno versionado o un texto con forma de secreto. Antes de crear un repo público en GitHub
// (y en el ensayo del generador, sobre lo que viajaría) se revisa todo lo versionado. Los patrones viven aquí y no en un comando: el
// hook de Bash bloquea un comando que nombre la secret key de Supabase. Puro. Se prueba en `publicar-proyecto.test.mjs`.

// Los patrones se arman por partes para que este archivo no se encuentre a sí mismo.
const PATRONES = [
  ['clave privada', new RegExp(['-----BEGIN ', '[A-Z ]*PRIVATE KEY-----'].join(''))],
  // Con su largo real (más de 20 caracteres): el hook de Bash tiene un caso de prueba corto que no es una clave.
  ['secret key de Supabase', new RegExp(['sb_', 'secret_[A-Za-z0-9_-]{20,}'].join(''))],
  ['token de GitHub', new RegExp(['gh[pousr]_', '[A-Za-z0-9]{30,}'].join(''))],
  ['token de GitHub', new RegExp(['github_', 'pat_'].join(''))],
  ['clave de Stripe', new RegExp(['sk_', 'live_'].join(''))],
  ['clave de AWS', new RegExp(['AKIA', '[0-9A-Z]{16}'].join(''))],
]

/** Un archivo de entorno que no es el ejemplo (`.env`, `.env.local`, `app/.env.produccion`…). */
export const esArchivoDeEntorno = (f) =>
  /(^|\/)\.env(\.|$)/.test(f) && !/(^|\/)\.env\.example$/.test(f)

/**
 * Los hallazgos en un mapa archivo → texto, `archivo:línea: tipo` (o `archivo: archivo de entorno versionado`). Puro.
 * @param {Record<string, string>} textos
 */
export function secretosEn(textos) {
  const hallazgos = []
  for (const [archivo, texto] of Object.entries(textos)) {
    if (esArchivoDeEntorno(archivo)) hallazgos.push(`${archivo}: archivo de entorno versionado`)
    texto.split('\n').forEach((linea, i) => {
      for (const [tipo, re] of PATRONES)
        if (re.test(linea)) hallazgos.push(`${archivo}:${i + 1}: ${tipo}`)
    })
  }
  return hallazgos
}
