import type { MetadataRoute } from 'next'
import { COLOR_FONDO_CLARO, COLOR_TEMA, DESCRIPCION_APP, NOMBRE_APP } from '@/shared/config/app'

// El manifest de la PWA. Los íconos los agrega el paso que trae la marca (public/iconos/).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: NOMBRE_APP,
    short_name: NOMBRE_APP,
    description: DESCRIPCION_APP,
    lang: 'es',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: COLOR_FONDO_CLARO,
    theme_color: COLOR_TEMA,
  }
}
