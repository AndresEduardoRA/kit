// La identidad de la app. semilla-a-repo reemplaza `{{NOMBRE}}` y `{{DESCRIPCION}}` con los de la semilla.
export const NOMBRE_APP = '{{NOMBRE}}'

export const DESCRIPCION_APP = '{{DESCRIPCION}}'

// El manifest y la barra del navegador no leen variables CSS: estos valores son copia de design/tokens.css (un test los compara):
// `--color-primario` y `--color-paper` en claro, y `--color-paper` en oscuro.
export const COLOR_TEMA = 'oklch(0.55 0.19 265)'
export const COLOR_FONDO_CLARO = 'oklch(0.975 0.004 265)'
export const COLOR_FONDO_OSCURO = 'oklch(0.18 0.015 265)'
