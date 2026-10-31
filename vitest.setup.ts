import '@testing-library/jest-dom/vitest'

// jsdom no trae `ResizeObserver` (lo usan los hooks que miden una caja): uno que no observa nada. Un test que necesita disparar un
// cambio de tamaño pone el suyo con `vi.stubGlobal('ResizeObserver', …)`.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
