---
esquema: semilla-proyecto/v2
nombre: Turnero
slug: turnero
descripcion: Turnos para una barbería con panel interno para el equipo y una web pública donde el cliente reserva
version: 1
repos:
  - rol: app
    descripcion: Panel interno de la barbería (agenda, barberos, clientes) y dueño de la base
    cuenta_github: AndresEduardoRA
    etapa: construccion
  - rol: web
    descripcion: Web pública con las horas libres y la reserva en tres pasos
    cuenta_github: AndresEduardoRA
    etapa: construccion
contratos:
  - id: agenda-publica
    proveedor: app
    consumidores: [web]
    tipo: base
    describe: horas libres por barbero y reservar un turno, sin datos de otros clientes
generada_con: {nivel: capaz, effort: medium, confirmado_por: dueño}
---

# Turnero · lo común

> Semilla de ejemplo: muestra el formato v2 y pasa el validador. No es un proyecto real.

## 1. Visión y alcance

**Qué es.** Una barbería de dos sillas deja de dar turnos por WhatsApp: el cliente reserva solo en la web y el equipo ve
la agenda del día en el panel. (A1)

**Primera versión.** Reservar desde la web, cancelar con el enlace del correo, agenda del día y de la semana en el panel,
alta de barberos y su horario. (A2)

**Fuera de alcance.** Pagos en línea, varias sucursales, recordatorios por WhatsApp. (A3)

**Cómo se mide.** El 60 % de los turnos del mes entra por la web a los tres meses. (A4)

## 2. Personas y roles

| Persona | Usa | Qué hace |
|---|---|---|
| Cliente | turnero-web | Ve horas libres, reserva y cancela su turno. No tiene cuenta. |
| Barbero | turnero-app | Ve su agenda, marca llegada o ausencia. |
| Dueño | turnero-app | Todo lo del barbero, más horarios, barberos y el informe del mes. (B1) |

## 3. Repos y fronteras

- **turnero-app** (`z_turnero/app`): el panel y la base de Supabase. Es el único que escribe datos. Publica el contrato
  `agenda-publica`.
- **turnero-web** (`z_turnero/web`): sitio público. No tiene base propia: lee y reserva sólo por el contrato. No guarda
  datos personales fuera de lo que manda al reservar. (C1)
- Comparten la marca (tokens de abajo) y el glosario. Nada más: ninguna sesión necesita la carpeta del otro repo.

## 4. Contratos entre repos

### agenda-publica · v1 (tipo base)

Lo publica turnero-app en `contratos/agenda-publica.json`, generado de su base local. Expone el esquema `publico`:

| Objeto | Forma | Quién puede |
|---|---|---|
| vista `publico.horas_libres` | `barbero_id uuid, barbero_nombre text, inicio timestamptz, fin timestamptz` | `anon`: select |
| RPC `publico.reservar_turno(p_barbero_id uuid, p_inicio timestamptz, p_nombre text, p_correo text)` | devuelve `turno_id uuid, codigo_cancelacion text` | `anon`: execute |
| RPC `publico.cancelar_turno(p_codigo text)` | devuelve `ok boolean` | `anon`: execute |

- turnero-app prueba en su CI que su base cumple cada versión vigente del contrato. (C2)
- turnero-web guarda la copia fijada en `.proyecto/contratos/agenda-publica@1.json` y su CI prueba que su código sólo
  llama a lo que está ahí. (C3)
- Un cambio es aditivo primero en app (v2), después web pasa a v2; lo que se quite, se quita cuando nadie usa v1.

## 5. Marca y sistema de diseño

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
- **Código de cancelación:** texto de 10 caracteres que llega por correo y permite cancelar sin cuenta.

## 7. Registro de decisiones

Está completo en `registro.md`. Lo de más impacto: la web no tiene base propia (C1); el contrato se prueba en las dos CI
sin mirar la base del otro (C2, C3).

## 8. Riesgos y supuestos

- Supuesto: el correo de confirmación sale por Resend en su plan gratis (G1). Si se pasa del cupo, se avisa al dueño.
- Riesgo: dos clientes eligen la misma hora a la vez; lo resuelve la RPC con un bloqueo y un conflicto legible (F1).
