// La parte del `gh` falso (gh-falso.mjs) que atiende repos nombrados explícitamente (`repos/<cuenta>/<repo>/…`) que están en
// `estado.git[<cuenta/repo>]`: el kit, visto desde un proyecto, y un proyecto, visto desde el kit (docs/KIT.md › «El flujo entre el
// kit y los proyectos»). Cada uno es `{ dir, issues, prs, sinAcceso, siguiente }`:
//   - `dir`, un repo de git local: `commits/<ref>` (sha y padres), `tarball/<sha>` (`git archive`, binario por stdout, con la carpeta
//     raíz `<cuenta>-<repo>-<sha>/` como GitHub) y `compare/<a>...<b>` (los archivos de `git diff --name-status -M`);
//   - `prs`: `pulls/<n>` (`merged`, `merge_commit_sha`) y `pulls/<n>/files` (sus `archivos`);
//   - `issues`: GET (filtra por `labels` y `state`) y POST (devuelve `number` y `html_url`);
//   - con `sinAcceso`, todo da `HTTP 404`, como un repo privado sin permiso.
import { spawnSync } from 'node:child_process'

/**
 * @param {{ e: any, repo: string, metodo: string, resto: string, q: URLSearchParams, campos: Record<string, any>,
 *   imprimir: (d: unknown) => void, salir: (c: number, m?: string) => never, guardar: () => void }} p
 */
export function atenderGit({ e, repo, metodo, resto, q, campos, imprimir, salir, guardar }) {
  const r = e.git[repo]
  if (r.sinAcceso) salir(1, `HTTP 404: Not Found (repos/${repo}/${resto})`)
  /** @param {string[]} a */
  const git = (...a) => spawnSync('git', ['-C', r.dir ?? '.', ...a], { encoding: 'utf8' })
  let m
  if ((m = /^commits\/(.+)$/.exec(resto))) {
    const g = git('rev-list', '--parents', '-n1', `${m[1]}^{commit}`)
    if (g.status !== 0) salir(1, `HTTP 422: No commit found for SHA: ${m[1]}`)
    const [sha, ...padres] = g.stdout.trim().split(' ')
    imprimir({ sha, parents: padres.map((p) => ({ sha: p })) })
  } else if ((m = /^tarball\/(.+)$/.exec(resto))) {
    const raiz = `${repo.replace('/', '-')}-${(m[1] ?? '').slice(0, 7)}/`
    const g = spawnSync(
      'git',
      ['-C', r.dir, 'archive', '--format=tar.gz', `--prefix=${raiz}`, m[1] ?? ''],
      {
        maxBuffer: 256 * 1024 * 1024,
      },
    )
    if (g.status !== 0) salir(1, `HTTP 404: Not Found (tarball/${m[1]})`)
    process.stdout.write(g.stdout)
  } else if ((m = /^compare\/(.+)\.\.\.(.+)$/.exec(resto))) {
    const d = git('diff', '--name-status', '-M', m[1] ?? '', m[2] ?? '')
    if (d.status !== 0) salir(1, `HTTP 404: Not Found (compare/${m[1]}...${m[2]})`)
    const files = d.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [st = '', a, b] = l.split('\t')
        if (st.startsWith('R')) return { filename: b, previous_filename: a, status: 'renamed' }
        return { filename: a, status: { A: 'added', D: 'removed' }[st[0] ?? ''] ?? 'modified' }
      })
    imprimir({ status: 'ahead', ahead_by: files.length, files })
  } else if ((m = /^pulls\/(\d+)(\/files)?$/.exec(resto))) {
    const p = (r.prs ?? []).find((/** @type {any} */ x) => String(x.number) === m?.[1])
    if (!p) salir(1, `HTTP 404: Not Found (pulls/${m[1]})`)
    if (m[2]) imprimir(p.archivos ?? [])
    else
      imprimir({
        number: p.number,
        merged: p.estado === 'MERGED',
        merge_commit_sha: p.sha ?? null,
        state: p.estado === 'OPEN' ? 'open' : 'closed',
      })
  } else if (resto === 'issues' && metodo === 'GET') {
    const quiere = (q.get('labels') ?? '').split(',').filter(Boolean)
    const estado = q.get('state') ?? 'open'
    imprimir(
      Object.values(r.issues ?? {}).filter(
        (/** @type {any} */ i) =>
          (estado === 'all' || i.state === estado) && quiere.every((l) => i.labels.includes(l)),
      ),
    )
  } else if (resto === 'issues' && metodo === 'POST') {
    r.siguiente ??= 1
    const n = r.siguiente++
    const html_url = `https://github.com/${repo}/issues/${n}`
    const i = {
      number: n,
      title: campos['title'],
      body: campos['body'],
      labels: campos['labels'] ?? [],
      state: 'open',
      html_url,
    }
    ;(r.issues ??= {})[n] = i
    guardar()
    imprimir(i)
  } else salir(2, `gh falso: no conozco la API ${metodo} repos/${repo}/${resto}`)
}
