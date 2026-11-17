// Las rutas de un proyecto salen de la principal del kit: desde un worktree, `<kit>/../..` caería en `kit/.orquestador`.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { carpetaOcupada, kitPrincipal, raizDelKit, rutasDelProyecto } from './rutas.mjs'

const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', ...a], {
    cwd,
    stdio: 'ignore',
  })

test('la raíz de proyectos es la misma desde la principal del kit y desde uno de sus worktrees', () => {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'proyectos-')))
  const kit = join(raiz, '_herramientas', 'kit')
  mkdirSync(kit, { recursive: true })
  git(kit, 'init', '-q', '-b', 'main')
  writeFileSync(join(kit, 'a'), 'x\n')
  git(kit, 'add', '.')
  git(kit, 'commit', '-q', '-m', 'x')
  const worktree = join(kit, '.orquestador', 'worktrees', 'T9')
  git(kit, 'worktree', 'add', '-q', '-b', 'feat/x', worktree)
  assert.equal(kitPrincipal(worktree), kit)
  assert.equal(kitPrincipal(kit), kit)
  assert.equal(raizDelKit(worktree), raiz)
  assert.equal(raizDelKit(kit), raiz)
  // --raiz (pruebas y CI) manda; sin git, el kit es la carpeta misma.
  assert.equal(raizDelKit(worktree, '/otra'), '/otra')
  const suelto = mkdtempSync(join(tmpdir(), 'sin-git-'))
  assert.equal(kitPrincipal(suelto), suelto)
})

test('rutasDelProyecto y carpetaOcupada', () => {
  const r = rutasDelProyecto('/p', 'turnero')
  assert.deepEqual(
    [r.carpeta, r.semilla, r.manifiesto, r.repo('web')],
    ['/p/z_turnero', '/p/z_turnero/semilla', '/p/z_turnero/proyecto.yaml', '/p/z_turnero/web'],
  )
  const dir = mkdtempSync(join(tmpdir(), 'ocupada-'))
  assert.equal(carpetaOcupada(join(dir, 'no-existe')), false)
  assert.equal(carpetaOcupada(dir), false)
  writeFileSync(join(dir, 'algo'), 'x')
  assert.equal(carpetaOcupada(dir), true)
  assert.equal(carpetaOcupada(join(dir, 'algo')), true)
})
