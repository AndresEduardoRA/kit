import { NOMBRE_APP } from '@/shared/config/app'

// La página de inicio del esqueleto. La reemplaza el primer paso con pantallas del plan (docs/semilla/plan.yaml).
export default function Inicio() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-(length:--text-xl) font-medium text-(--color-ink)">{NOMBRE_APP}</h1>
      <p className="max-w-md text-(length:--text-base) text-(--color-ink-soft)">
        El proyecto está listo. Lo que sigue lo construyen los pasos del plan.
      </p>
    </main>
  )
}
