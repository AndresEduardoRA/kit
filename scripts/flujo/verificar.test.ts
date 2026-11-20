import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// `verificar.sh` corre lint, tipos, la suite y el mapa en paralelo y recuerda el árbol que pasó (docs/FLUJO.md). Se prueba con un `pnpm`
// falso y un `mapa.sh` falso: cada uno anota que arrancó y espera a que arranquen los cuatro (si corrieran en serie, ninguno vería a los
// cuatro). El guion se copia a un repo temporal y se corre desde ahí, como en un proyecto.
const GUION_DEL_KIT = resolve('scripts/flujo/verificar.sh')
const raices: string[] = []
let raiz = ''
let repo = ''

const FALSO = (nombre: string) => `#!/usr/bin/env bash
mkdir -p "$RAIZ/arranques"
touch "$RAIZ/arranques/${nombre}"
for _ in $(seq 1 100); do
  [ "$(ls "$RAIZ/arranques" | wc -l)" -ge 4 ] && break
  sleep 0.05
done
echo "${nombre} $(ls "$RAIZ/arranques" | wc -l)" >>"$RAIZ/corridas"
case " $FALLA " in *" ${nombre} "*) echo "salida de ${nombre}"; echo "motivo-de-${nombre}" >&2; exit 3 ;; esac
exit 0
`

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'verificar-'))
  raices.push(raiz)
  repo = join(raiz, 'repo')
  mkdirSync(join(raiz, 'bin'))
  writeFileSync(join(raiz, 'bin', 'pnpm'), `#!/usr/bin/env bash\nexec bash "$RAIZ/falso.sh" "$1"\n`)
  chmodSync(join(raiz, 'bin', 'pnpm'), 0o755)
  writeFileSync(join(raiz, 'falso.sh'), FALSO('$1'))
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'a@b.c'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'a'])
  mkdirSync(join(repo, 'scripts/flujo'), { recursive: true })
  copyFileSync(GUION_DEL_KIT, join(repo, 'scripts/flujo/verificar.sh'))
  writeFileSync(join(repo, 'scripts/mapa.sh'), FALSO('mapa'))
  writeFileSync(join(repo, '.gitignore'), 'ignorado.txt\n')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  execFileSync('git', ['-C', repo, 'add', '-A'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'inicial'])
})
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

function verificar(opciones: { falla?: string; args?: string[] } = {}) {
  rmSync(join(raiz, 'arranques'), { recursive: true, force: true })
  rmSync(join(raiz, 'corridas'), { force: true })
  const r = spawnSync(
    'bash',
    [join(repo, 'scripts/flujo/verificar.sh'), ...(opciones.args ?? [])],
    {
      cwd: repo,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        HOME: raiz,
        TMPDIR: raiz,
        RAIZ: raiz,
        FALLA: opciones.falla ?? '',
        PATH: `${join(raiz, 'bin')}:${process.env['PATH'] ?? ''}`,
      },
    },
  )
  const corridas = existsSync(join(raiz, 'corridas'))
    ? readFileSync(join(raiz, 'corridas'), 'utf8').trim().split('\n').filter(Boolean)
    : []
  return { codigo: r.status, salida: r.stdout, corridas }
}

function recuerdo() {
  const ruta = execFileSync('git', ['-C', repo, 'rev-parse', '--git-path', 'verificado-main'], {
    encoding: 'utf8',
  }).trim()
  const absoluta = resolve(repo, ruta)
  return existsSync(absoluta) ? readFileSync(absoluta, 'utf8').trim() : null
}

describe('verificar.sh', () => {
  it('corre los cuatro en paralelo, resume una línea por comando y guarda el árbol', () => {
    const r = verificar()
    expect(r.codigo).toBe(0)
    expect(r.corridas.sort()).toEqual(['lint 4', 'mapa 4', 'test 4', 'typecheck 4'])
    expect(r.salida).toContain('✓ pnpm lint')
    expect(r.salida).toContain('✓ pnpm typecheck')
    expect(r.salida).toContain('✓ pnpm test')
    expect(r.salida).toContain('✓ bash scripts/mapa.sh --check')
    expect(r.salida).toContain('todo verificado')
    expect(recuerdo()).toMatch(/^[0-9a-f]{40}$/)
  })

  it('con el mismo árbol dice «ya verificado» y no corre nada', () => {
    verificar()
    const r = verificar()
    expect(r.codigo).toBe(0)
    expect(r.salida).toContain('ya verificado')
    expect(r.corridas).toEqual([])
  })

  it('un commit que no cambia el árbol (o lo ignorado) no vuelve a correr', () => {
    verificar()
    writeFileSync(join(repo, 'ignorado.txt'), 'x\n')
    expect(verificar().corridas).toEqual([])
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'vacío'])
    expect(verificar().corridas).toEqual([])
  })

  it('corre otra vez si cambió un archivo, sin commitear o commiteado', () => {
    verificar()
    writeFileSync(join(repo, 'a.txt'), 'b\n')
    expect(verificar().corridas).toHaveLength(4)
    expect(verificar().corridas).toEqual([])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'cambio'])
    expect(verificar().corridas).toEqual([])
    writeFileSync(join(repo, 'nuevo.txt'), 'n\n')
    expect(verificar().corridas).toHaveLength(4)
  })

  it('--forzar corre igual aunque el árbol sea el verificado', () => {
    verificar()
    const r = verificar({ args: ['--forzar'] })
    expect(r.codigo).toBe(0)
    expect(r.corridas).toHaveLength(4)
  })

  it('si cae uno sale con 1, muestra su cola, corre los demás y no guarda el árbol', () => {
    const r = verificar({ falla: 'typecheck' })
    expect(r.codigo).toBe(1)
    expect(r.corridas).toHaveLength(4)
    expect(r.salida).toContain('✓ pnpm lint')
    expect(r.salida).toContain('✗ pnpm typecheck: salió con 3')
    expect(r.salida).toContain('motivo-de-typecheck')
    expect(recuerdo()).toBeNull()
    // sin árbol guardado, la siguiente corre otra vez
    expect(verificar().corridas).toHaveLength(4)
  })

  it('una caída borra el árbol guardado antes (con --forzar)', () => {
    verificar()
    expect(recuerdo()).not.toBeNull()
    const r = verificar({ falla: 'mapa', args: ['--forzar'] })
    expect(r.codigo).toBe(1)
    expect(recuerdo()).toBeNull()
  })

  it('un argumento que no conoce es un error de uso', () => {
    const r = verificar({ args: ['--otra'] })
    expect(r.codigo).toBe(2)
    expect(readdirSync(raiz)).not.toContain('corridas')
  })
})
