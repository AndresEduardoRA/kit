---
esquema: semilla/v1
nombre: Turnero
slug: turnero
descripcion: Panel interno de la barbería y dueño de la base de turnos
version: 1
tamano: chico
tipo: interno
plataforma: web (escritorio primero, celular cuidado)
arquitectura: monolito modular del kit (src/modules + src/shared) con Supabase
stack: {base: el del kit}
servicios: [supabase, vercel, resend]
funciones_edge: []
compuertas_rojas: [datos]
agentes: [claude]
tope_cuota: {ventana_5h_pct: 30, semanal_pct: 20}
piloto_auto_min: 5
generada_con: {modelo: opus, effort: medium, confirmado_por: dueño}
---

# Turnero

> Semilla v1 mínima para el job «kit · proyecto de ejemplo» del CI: el repo `app` del turnero de `scripts/semilla/ejemplo/`, en el
> formato que `scripts/kit/nuevo-proyecto.mjs` entiende hoy. Pasa `scripts/kit/fixtures/validar_semilla_v1.py`. No es un proyecto
> real; la reemplaza el ejemplo v2 cuando el generador lo lea (K09).

## 1. Visión y alcance

**Qué es.** Una barbería de dos sillas deja de dar turnos por WhatsApp: el equipo ve la agenda del día en el panel. (A1)

**Primera versión.** Agenda del día y de la semana, alta de barberos y su horario, marcar llegada o ausencia. (A2)

**Fuera de alcance.** Pagos en línea, varias sucursales, recordatorios por WhatsApp. (A3)

**Cómo se mide.** El 60 % de los turnos del mes se registra en el panel a los tres meses. (A4)

## 2. Roles y permisos

| Rol | Turnos | Barberos | Horarios |
|---|---|---|---|
| barbero | ver y marcar los suyos | ver | ver el suyo |
| dueño | todo | todo | todo |

El barbero y el dueño entran con cuenta. (B1)

## 3. Experiencia

| Pantalla | Ruta | Rol | Contenido | Estados |
|---|---|---|---|---|
| Agenda del día | `/agenda` | barbero, dueño | turnos por barbero y hora | vacío, carga, error, sin permiso, sin conexión |
| Semana | `/agenda/semana` | dueño | grilla de 7 días | igual |
| Barberos | `/barberos` | dueño | lista y horario | igual |

Recorrido: el barbero entra con enlace mágico (F2), ve su día, toca un turno y marca «llegó».

## 4. Escala y rendimiento

Listas con cursor y tope de 50 en un solo punto; la agenda trae sólo el día pedido; sin conteos exactos. Volumen de prueba:
20.000 turnos. Presupuesto: agenda en 2 peticiones y 40 KB.

## 5. Sistema de diseño

Adjetivos: cercano, sobrio, rápido. Modo claro por defecto, oscuro disponible. Tipografía Inter. (E1, E2)

```css
:root {
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-card: 0.75rem;
  --radius-pill: 999px;
  --fila-compacta: 2.25rem;
  --fila-comoda: 3rem;
  --sidebar: 15rem;
  --topbar: 3.5rem;
  --color-primario: oklch(0.45 0.12 250);
  --color-primario-oscuro: oklch(0.38 0.12 250);
  --color-primario-soft: oklch(0.95 0.03 250);
  --color-primario-ink: oklch(0.4 0.12 250);
  --color-sobre-primario: oklch(0.99 0 0);
  --color-paper: oklch(0.99 0.003 250);
  --color-paper-soft: oklch(0.975 0.004 250);
  --color-paper-dim: oklch(0.95 0.005 250);
  --color-surface: oklch(1 0 0);
  --color-surface-2: oklch(0.985 0.003 250);
  --color-surface-3: oklch(0.97 0.004 250);
  --color-ink: oklch(0.22 0.02 250);
  --color-ink-soft: oklch(0.4 0.02 250);
  --color-ink-faint: oklch(0.5 0.015 250);
  --color-line: oklch(0.91 0.006 250);
  --color-line-strong: oklch(0.82 0.01 250);
  --color-overlay: oklch(0.2 0.02 250 / 0.5);
  --color-positivo: oklch(0.6 0.14 150);
  --color-positivo-soft: oklch(0.95 0.04 150);
  --color-positivo-ink: oklch(0.4 0.1 150);
  --color-aviso: oklch(0.75 0.15 80);
  --color-aviso-soft: oklch(0.96 0.05 80);
  --color-aviso-ink: oklch(0.45 0.1 70);
  --color-peligro: oklch(0.58 0.2 27);
  --color-peligro-soft: oklch(0.95 0.03 27);
  --color-peligro-ink: oklch(0.45 0.16 27);
  --color-info: oklch(0.6 0.12 230);
  --color-info-soft: oklch(0.95 0.03 230);
  --color-info-ink: oklch(0.42 0.1 230);
  --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.06);
  --shadow-md: 0 4px 12px oklch(0 0 0 / 0.08);
  --shadow-lg: 0 12px 32px oklch(0 0 0 / 0.12);
  --shadow-focus: 0 0 0 3px oklch(0.45 0.12 250 / 0.35);
  --dur-rapida: 120ms;
  --dur-normal: 200ms;
  --dur-pagina: 320ms;
  --ease-salida: cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dark {
  --color-paper: oklch(0.18 0.01 250);
  --color-surface: oklch(0.22 0.012 250);
  --color-ink: oklch(0.95 0.005 250);
  --color-positivo-soft: oklch(0.3 0.05 150);
  --color-positivo-ink: oklch(0.85 0.1 150);
}
```

Contraste: `--color-ink` sobre `--color-paper` 15,8:1 y `--color-ink-faint` 5,1:1, calculados con código. (E3)

## 6. Glosario

- **Turno:** una reserva de un cliente con un barbero, de 30 minutos. (D1)
- **Hora libre:** un tramo de 30 minutos dentro del horario de un barbero sin turno ni bloqueo.

## 7. Riesgos y supuestos

- Supuesto: el correo del enlace mágico sale por Resend en su plan gratis (G1).
- Riesgo: dos personas toman la misma hora a la vez; lo resuelve la RPC con un bloqueo y un conflicto legible (F1).
