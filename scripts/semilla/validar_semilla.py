#!/usr/bin/env python3
"""Valida la semilla de un proyecto (semilla-proyecto/v2, semilla-repo/v2, plan/v2) o su manifiesto (proyecto/v1).

Uso:
  python3 validar_semilla.py <z_proyecto>/semilla          la semilla entera: lo común y cada repo en construcción
  python3 validar_semilla.py --manifiesto <proyecto.yaml>  el manifiesto del proyecto (o la copia .proyecto/ de un repo)

Sale con 0 si pasa y 1 si hay errores. Requiere PyYAML (Ubuntu/Debian: sudo apt install python3-yaml).

La carpeta de la semilla:
  comun.md                     lo común: visión, personas, repos, contratos, marca y tokens, glosario, registro, riesgos
  repos/<rol>/semilla.md       lo de un repo en construcción
  repos/<rol>/plan.yaml        sus pasos (plan/v2)
  registro.md                  todas las decisiones del proyecto (ID | tema | decisión | estado | fuente)
  ESTADO.md, plantilla.md, CHANGELOG.md, retro.md (no se validan)
"""
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("Falta PyYAML: sudo apt install python3-yaml")

# ---------------------------------------------------------------- reglas

PROHIBIDAS = [r"\bTBD\b", r"\ba definir\b", r"\bsegún criterio\b", r"\betc\.", r"\bpor definir\b",
              r"\bpendiente de decidir\b"]
# Nada de versiones de modelo: el ruteo nombra un nivel y la skill verifica qué modelo es hoy.
VERSION_DE_MODELO = r"\b(?:Opus|Sonnet|Haiku|Fable|Mythos)\s+\d+(?:\.\d+)?\b|\bclaude-(?:opus|sonnet|haiku|fable|mythos)-\d"
SLUG = r"^[a-z][a-z0-9-]{1,30}$"
ROL = r"^[a-z]{2,12}$"
CONTRATO = r"^[a-z][a-z0-9-]{1,30}$"
ID_DECISION = r"[A-Z]{1,3}\d+(?:\.\d+)?"
ETAPAS = {"construccion", "mantenimiento"}
RIESGOS = {"rojo", "ambar", "verde"}
NIVELES = {"rapido", "normal", "capaz"}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
SI_NO = {"si", "no"}
TIPOS_CONTRATO = {"base", "http", "archivo"}

SECCIONES_COMUN = ["Visión y alcance", "Personas y roles", "Repos y fronteras", "Contratos entre repos",
                   "Marca y sistema de diseño", "Glosario", "Registro de decisiones", "Riesgos y supuestos"]
SECCIONES_REPO = ["Alcance del repo", "Roles y permisos", "Datos", "Seguridad", "Reglas de negocio y fórmulas",
                  "Experiencia", "Escala y rendimiento", "Sistema de diseño", "Técnica", "Verificación",
                  "Plan de ejecución", "Riesgos y supuestos"]
CAMPOS_COMUN = ["esquema", "nombre", "slug", "descripcion", "version", "repos", "contratos", "generada_con"]
CAMPOS_REPO = ["esquema", "proyecto", "rol", "nombre", "descripcion", "version", "tamano", "tipo", "plataforma",
               "arquitectura", "stack", "servicios", "funciones_edge"]
TAMANOS = {"chico", "mediano", "grande", "escala"}

# El contrato de tokens del kit (design/tokens.css): se pueden agregar otros, nunca quitar éstos.
TOKENS = """--font-sans --font-mono --text-xs --text-sm --text-base --text-lg --text-xl --text-2xl --radius-sm
--radius-md --radius-card --radius-pill --fila-compacta --fila-comoda --sidebar --topbar --color-primario
--color-primario-oscuro --color-primario-soft --color-primario-ink --color-sobre-primario --color-paper
--color-paper-soft --color-paper-dim --color-surface --color-surface-2 --color-surface-3 --color-ink
--color-ink-soft --color-ink-faint --color-line --color-line-strong --color-overlay --color-positivo
--color-positivo-soft --color-positivo-ink --color-aviso --color-aviso-soft --color-aviso-ink --color-peligro
--color-peligro-soft --color-peligro-ink --color-info --color-info-soft --color-info-ink --shadow-sm --shadow-md
--shadow-lg --shadow-focus --dur-rapida --dur-normal --dur-pagina --ease-salida""".split()

errores, avisos = [], []


def err(msg):
    errores.append(msg)


def aviso(msg):
    avisos.append(msg)


# ---------------------------------------------------------------- lectura

def frontmatter(texto, donde):
    m = re.match(r"^---\n(.*?)\n---", texto, re.S)
    if not m:
        err(f"{donde}: no empieza con frontmatter YAML")
        return {}
    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as e:
        err(f"{donde}: el frontmatter no es YAML válido ({e})")
        return {}


def titulos(texto):
    return [re.sub(r"^\d+\.\s*", "", t).strip() for t in re.findall(r"^##\s+(.+?)\s*$", texto, re.M)]


def seccion(texto, titulo):
    lineas = texto.split("\n")
    rx = re.compile(rf"^##\s+(\d+\.\s*)?{re.escape(titulo)}\s*$")
    i = next((k for k, l in enumerate(lineas) if rx.match(l)), None)
    if i is None:
        return None
    j = next((k for k in range(i + 1, len(lineas)) if lineas[k].startswith("## ")), len(lineas))
    return "\n".join(lineas[i + 1:j]).strip()


def secciones_exactas(texto, esperadas, donde):
    hay = titulos(texto)
    faltan = [s for s in esperadas if s not in hay]
    if faltan:
        err(f"{donde}: faltan las secciones {', '.join('«' + f + '»' for f in faltan)} (títulos exactos: ## <n>. <Título>)")
    orden = [s for s in hay if s in esperadas]
    if not faltan and orden != esperadas:
        err(f"{donde}: las secciones no van en el orden de la plantilla")
    for s in esperadas:
        cuerpo = seccion(texto, s)
        if cuerpo is not None and len(cuerpo) < 20:
            err(f"{donde}: la sección «{s}» está vacía")


def texto_prohibido(texto, donde):
    for patron in PROHIBIDAS:
        for m in re.finditer(patron, texto, re.I):
            err(f"{donde} línea {texto.count(chr(10), 0, m.start()) + 1}: texto prohibido «{m.group(0)}»")
    for m in re.finditer(VERSION_DE_MODELO, texto):
        err(f"{donde} línea {texto.count(chr(10), 0, m.start()) + 1}: versión de modelo fija «{m.group(0)}» "
            "(el ruteo nombra un nivel: rapido, normal o capaz)")
    n = texto.count("«verificar»")
    if n:
        aviso(f"{donde}: {n} marcas «verificar»: ciérralas antes de semilla-a-repo")


def leer_registro(carpeta):
    reg = carpeta / "registro.md"
    if not reg.exists():
        err("No existe registro.md")
        return set()
    ids = set()
    for linea in reg.read_text(encoding="utf-8").splitlines():
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        if len(celdas) >= 4 and re.fullmatch(ID_DECISION, celdas[0]):
            if celdas[0] in ids:
                err(f"registro.md: el ID {celdas[0]} está repetido")
            ids.add(celdas[0])
            estado = celdas[3].lower()
            if "abierta" in estado or "contradic" in estado:
                err(f"registro.md: {celdas[0]} sigue en estado «{celdas[3]}»")
    if not ids:
        err("registro.md no tiene filas con ID")
    return ids


# ---------------------------------------------------------------- tokens

def bloque_css(css, selector):
    m = re.search(rf"^{re.escape(selector)}\s*\{{", css, re.M)
    if not m:
        return None
    return css[m.start():css.index("}", m.start()) + 1]


def validar_tokens(comun):
    sec = seccion(comun, "Marca y sistema de diseño")
    if sec is None:
        return
    bloques = [b for b in re.findall(r"```css\n(.*?)```", sec, re.S) if re.search(r":root\s*\{", b)]
    if len(bloques) != 1:
        err("comun.md: «Marca y sistema de diseño» debe traer un solo bloque ```css con `:root { … }`")
        return
    css = bloques[0]
    raiz, oscuro = bloque_css(css, ":root"), bloque_css(css, ".dark")
    nombres = set(re.findall(r"(--[a-z0-9-]+)\s*:", raiz or ""))
    faltan = [t for t in TOKENS if t not in nombres]
    if faltan:
        err("comun.md: a `:root` le faltan tokens del contrato del kit: " + " ".join(faltan))
    if not oscuro:
        err("comun.md: el tema oscuro va como `.dark { … }` en el mismo bloque")
    elif not re.search(r"--color-paper\s*:", oscuro):
        err("comun.md: falta --color-paper en `.dark` (el manifest de la PWA lo copia)")
    if raiz and re.search(r"--color-[a-z-]+\s*:\s*#", raiz):
        aviso("comun.md: hay colores en hexadecimal; el kit usa OKLCH")


# ---------------------------------------------------------------- plan

def solapan(a, b):
    a, b = a.rstrip("/") + "/", b.rstrip("/") + "/"
    return a.startswith(b) or b.startswith(a)


def validar_plan(rol, ruta, ids_registro, roles_construccion):
    """Valida un plan/v2 y devuelve sus pasos (id → paso) para las comprobaciones entre repos."""
    pref0 = f"repos/{rol}/plan.yaml"
    if not ruta.exists():
        err(f"No existe {pref0}")
        return {}
    try:
        plan = yaml.safe_load(ruta.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        err(f"{pref0}: no es YAML válido ({e})")
        return {}
    if plan.get("esquema") != "plan/v2":
        err(f"{pref0}: esquema debe ser plan/v2")
    carriles = {}
    for c in plan.get("carriles") or []:
        cid = str(c.get("id", ""))
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,19}", cid):
            err(f"{pref0}: el carril «{cid}» no sirve (minúsculas, números y guiones, hasta 20)")
        carriles[cid] = c
    if not carriles:
        err(f"{pref0}: sin carriles")
    lista = list(carriles.values())
    for i, a in enumerate(lista):
        for b in lista[i + 1:]:
            for ra in a.get("dueno_de") or []:
                for rb in b.get("dueno_de") or []:
                    if solapan(ra, rb):
                        err(f"{pref0}: los carriles {a['id']} y {b['id']} comparten {ra} / {rb}")

    pasos_lista = plan.get("pasos") or []
    pasos = {}
    for p in pasos_lista:
        pid = str(p.get("id", ""))
        if pid in pasos:
            err(f"{pref0}: el paso {pid} está repetido")
        pasos[pid] = p
    if not pasos:
        err(f"{pref0}: sin pasos")

    for pid, p in pasos.items():
        pref = f"{rol}:{pid}"
        if not re.fullmatch(r"P\d{2,3}", pid):
            err(f"{pref}: el id va como P01")
        for campo in ("titulo", "depende_de", "carril", "riesgo", "modulos", "decisiones", "ruteo", "verificacion",
                      "terminado"):
            if campo not in p:
                err(f"{pref}: falta «{campo}»")
        if p.get("riesgo") not in RIESGOS:
            err(f"{pref}: riesgo inválido (rojo, ambar o verde)")
        if p.get("carril") not in carriles:
            err(f"{pref}: el carril «{p.get('carril')}» no existe")
        else:
            propias = carriles[p["carril"]].get("dueno_de") or []
            for m in p.get("modulos") or []:
                if not m.startswith("docs/") and not any(
                        (m.rstrip("/") + "/").startswith(r.rstrip("/") + "/") for r in propias):
                    err(f"{pref}: toca {m}, que no es del carril {p['carril']}")
        for d in p.get("depende_de") or []:
            d = str(d)
            if ":" in d:
                otro, _ = d.split(":", 1)
                if otro == rol:
                    err(f"{pref}: depende de {d}: dentro del mismo repo va sin prefijo")
                elif otro not in roles_construccion:
                    err(f"{pref}: depende de {d}, pero «{otro}» no es un repo en construcción de este proyecto")
            elif d not in pasos:
                err(f"{pref}: depende de {d}, que no existe")
        for dec in p.get("decisiones") or []:
            if ids_registro and str(dec) not in ids_registro:
                err(f"{pref}: cita la decisión {dec}, que no está en el registro")

        r = dict(p.get("ruteo") or {})
        for k in ("planificar", "revisor"):  # YAML lee «no» como falso
            if isinstance(r.get(k), bool):
                r[k] = "si" if r[k] else "no"
        extra = set(r) - {"nivel", "effort", "planificar", "revisor"}
        if extra:
            err(f"{pref}: el ruteo sólo lleva nivel, effort, planificar y revisor (sobra {', '.join(sorted(extra))})")
        if r.get("nivel") not in NIVELES:
            err(f"{pref}: nivel inválido (rapido, normal o capaz)")
        if r.get("effort") not in EFFORTS:
            err(f"{pref}: effort inválido")
        if r.get("planificar") not in SI_NO or r.get("revisor") not in SI_NO:
            err(f"{pref}: planificar y revisor van como si o no")
        if p.get("riesgo") == "rojo":
            if r.get("nivel") != "capaz":
                err(f"{pref}: un paso rojo va con nivel capaz")
            if r.get("effort") not in {"high", "xhigh", "max"}:
                err(f"{pref}: un paso rojo necesita effort high o más")
            if r.get("planificar") != "si":
                err(f"{pref}: un paso rojo planifica antes (planificar: si)")
            if r.get("revisor") != "si":
                err(f"{pref}: un paso rojo lleva revisor (revisor: si)")
        if r.get("effort") == "max":
            aviso(f"{pref}: effort max sólo después de que xhigh falló")

        v = p.get("verificacion") or {}
        if v.get("nivel") not in (1, 2, 3) or not v.get("comando"):
            err(f"{pref}: la verificación necesita nivel 1-3 y comando")
        if re.search(r"manual|a mano|pruébalo", str(v.get("comando", "")), re.I):
            err(f"{pref}: la verificación no puede ser manual")
        if re.search(r"manual|a mano|pruébalo tú", str(p.get("terminado", "")), re.I):
            err(f"{pref}: el criterio de terminado no puede pedir una prueba manual")

        c = p.get("contrato")
        if c is not None:
            if not isinstance(c, dict) or len(c) != 1 or next(iter(c)) not in {"provee", "consume"}:
                err(f"{pref}: contrato va como {{provee: <id>@<n>}} o {{consume: <id>@<n>}}")
            elif not re.fullmatch(r"[a-z][a-z0-9-]{1,30}@\d+", str(next(iter(c.values())))):
                err(f"{pref}: el contrato va como <id>@<versión>, por ejemplo agenda@1")

    # Pasos en paralelo (sin relación de dependencia dentro del repo) no tocan el mismo módulo.
    ancestros, estado = {}, {}

    def visitar(pid):
        if estado.get(pid) == 1:
            return set()
        if estado.get(pid) == 2:
            return ancestros[pid]
        estado[pid] = 1
        acc = set()
        for d in pasos[pid].get("depende_de") or []:
            d = str(d)
            if ":" not in d and d in pasos:
                acc |= {d} | visitar(d)
        estado[pid], ancestros[pid] = 2, acc
        return acc

    for pid in pasos:
        visitar(pid)
    ids = list(pasos)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if a in ancestros.get(b, set()) or b in ancestros.get(a, set()):
                continue
            for ma in pasos[a].get("modulos") or []:
                for mb in pasos[b].get("modulos") or []:
                    if solapan(ma, mb) and not ma.startswith("docs/"):
                        err(f"{rol}: {a} y {b} pueden correr en paralelo y los dos tocan {ma} / {mb}")
    return pasos


def ciclos_del_proyecto(planes):
    """Ciclos en el grafo de todos los repos juntos (los depende_de con prefijo cruzan repos)."""
    nodos = {f"{rol}:{pid}": p for rol, pasos in planes.items() for pid, p in pasos.items()}

    def deps(nodo):
        rol = nodo.split(":")[0]
        for d in nodos[nodo].get("depende_de") or []:
            d = str(d)
            n = d if ":" in d else f"{rol}:{d}"
            if n in nodos:
                yield n

    color = {}
    for inicio in nodos:
        if color.get(inicio):
            continue
        pila = [(inicio, iter(deps(inicio)))]
        color[inicio] = 1
        while pila:
            nodo, hijos = pila[-1]
            sig = next(hijos, None)
            if sig is None:
                color[nodo] = 2
                pila.pop()
            elif color.get(sig) == 1:
                err(f"Ciclo de dependencias que pasa por {sig}")
                return
            elif not color.get(sig):
                color[sig] = 1
                pila.append((sig, iter(deps(sig))))
    for n in nodos:
        for d in nodos[n].get("depende_de") or []:
            d = str(d)
            if ":" in d and d not in nodos:
                err(f"{n}: depende de {d}, que no existe")
    return nodos


def alcanzables(nodos, desde):
    vistos, pila = set(), [desde]
    while pila:
        n = pila.pop()
        rol = n.split(":")[0]
        for d in nodos[n].get("depende_de") or []:
            d = str(d)
            m = d if ":" in d else f"{rol}:{d}"
            if m in nodos and m not in vistos:
                vistos.add(m)
                pila.append(m)
    return vistos


# ---------------------------------------------------------------- la semilla

def validar_semilla(carpeta: Path):
    if (carpeta / "semilla.md").exists() and not (carpeta / "comun.md").exists():
        err("Es una semilla/v1 de un solo repo: conviértela a v2 con idea-a-semilla (modo conversión)")
        return
    ruta_comun = carpeta / "comun.md"
    if not ruta_comun.exists():
        err("No existe comun.md")
        return
    comun = ruta_comun.read_text(encoding="utf-8")
    fm = frontmatter(comun, "comun.md")
    if fm.get("esquema") != "semilla-proyecto/v2":
        err("comun.md: esquema debe ser semilla-proyecto/v2")
    for campo in CAMPOS_COMUN:
        if campo not in fm:
            err(f"comun.md: falta «{campo}» en el frontmatter")
    slug = str(fm.get("slug", ""))
    if not re.fullmatch(SLUG, slug):
        err(f"comun.md: el slug «{slug}» no sirve (minúsculas, números y guiones, de 2 a 31; la carpeta es z_{slug})")
    if carpeta.resolve().parent.name not in (f"z_{slug}", "ejemplo") and carpeta.resolve().parent.name != slug:
        aviso(f"la semilla está en {carpeta.resolve().parent.name}/, y el proyecto «{slug}» vive en z_{slug}/")
    gc = fm.get("generada_con") or {}
    if gc.get("nivel") != "capaz" or not gc.get("effort") or not gc.get("confirmado_por"):
        err("comun.md: generada_con lleva {nivel: capaz, effort: <el confirmado>, confirmado_por: dueño}")
    secciones_exactas(comun, SECCIONES_COMUN, "comun.md")
    texto_prohibido(comun, "comun.md")
    validar_tokens(comun)

    repos = fm.get("repos") or []
    if not repos:
        err("comun.md: el proyecto no declara repos")
    roles, construccion = {}, set()
    for r in repos:
        rol = str(r.get("rol", ""))
        if not re.fullmatch(ROL, rol):
            err(f"comun.md: el rol «{rol}» no sirve (minúsculas, de 2 a 12 letras: app, web, crm…)")
        if rol in roles:
            err(f"comun.md: el rol {rol} está repetido")
        roles[rol] = r
        if r.get("etapa") not in ETAPAS:
            err(f"comun.md: {rol} necesita etapa construccion o mantenimiento")
        if not r.get("cuenta_github"):
            err(f"comun.md: {rol} necesita cuenta_github (la cuenta dueña del repo)")
        if not r.get("descripcion"):
            err(f"comun.md: {rol} necesita una descripcion de una línea")
        if r.get("etapa") == "construccion":
            construccion.add(rol)
    sec_repos = seccion(comun, "Repos y fronteras") or ""
    for rol in roles:
        if f"{slug}-{rol}" not in sec_repos:
            err(f"comun.md: «Repos y fronteras» no describe {slug}-{rol}")

    contratos = {}
    for c in fm.get("contratos") or []:
        cid = str(c.get("id", ""))
        if not re.fullmatch(CONTRATO, cid):
            err(f"comun.md: el contrato «{cid}» no sirve como id")
        contratos[cid] = c
        if c.get("proveedor") not in roles:
            err(f"comun.md: el contrato {cid} tiene un proveedor que no es un repo del proyecto")
        cons = c.get("consumidores") or []
        if not cons:
            err(f"comun.md: el contrato {cid} no tiene consumidores")
        for k in cons:
            if k not in roles:
                err(f"comun.md: el contrato {cid} nombra al consumidor {k}, que no es un repo del proyecto")
            if k == c.get("proveedor"):
                err(f"comun.md: en el contrato {cid} el proveedor no puede consumirse a sí mismo")
        if c.get("tipo") not in TIPOS_CONTRATO:
            err(f"comun.md: el contrato {cid} necesita tipo base, http o archivo")
        if cid not in (seccion(comun, "Contratos entre repos") or ""):
            err(f"comun.md: «Contratos entre repos» no detalla {cid}")

    ids = leer_registro(carpeta)
    textos = [comun]
    planes = {}
    for rol in sorted(construccion):
        ruta = carpeta / "repos" / rol / "semilla.md"
        donde = f"repos/{rol}/semilla.md"
        if not ruta.exists():
            err(f"No existe {donde} ({rol} está en construcción)")
            continue
        texto = ruta.read_text(encoding="utf-8")
        textos.append(texto)
        frm = frontmatter(texto, donde)
        if frm.get("esquema") != "semilla-repo/v2":
            err(f"{donde}: esquema debe ser semilla-repo/v2")
        for campo in CAMPOS_REPO:
            if campo not in frm:
                err(f"{donde}: falta «{campo}» en el frontmatter")
        if frm.get("proyecto") != slug or frm.get("rol") != rol:
            err(f"{donde}: proyecto y rol deben ser {slug} y {rol}")
        if frm.get("nombre") != f"{slug}-{rol}":
            err(f"{donde}: el nombre debe ser {slug}-{rol}")
        if frm.get("tamano") not in TAMANOS:
            err(f"{donde}: tamano inválido")
        secciones_exactas(texto, SECCIONES_REPO, donde)
        texto_prohibido(texto, donde)
        planes[rol] = validar_plan(rol, carpeta / "repos" / rol / "plan.yaml", ids, construccion)
    for rol in roles:
        if rol not in construccion and (carpeta / "repos" / rol).exists():
            aviso(f"repos/{rol}/ existe pero {rol} está en mantenimiento: semilla-a-repo no lo usa")

    todo = "\n".join(textos)
    faltan = sorted(i for i in ids if not re.search(rf"(?<![A-Za-z0-9.]){re.escape(i)}(?![0-9])", todo))
    if faltan:
        err("IDs del registro que no aparecen en la semilla: " + ", ".join(faltan))

    nodos = ciclos_del_proyecto(planes) or {}
    # Cada contrato: el proveedor lo publica en un paso; cada consumidor lo adopta en un paso que espera a ése.
    for cid, c in contratos.items():
        prov = c.get("proveedor")
        if prov not in construccion:
            aviso(f"el contrato {cid} lo publica {prov}, que está en mantenimiento: va como pedido con piloto-prompts")
            continue
        publica = [f"{prov}:{pid}" for pid, p in planes.get(prov, {}).items()
                   if str((p.get("contrato") or {}).get("provee", "")).startswith(cid + "@")]
        if not publica:
            err(f"{prov}: ningún paso publica el contrato {cid} (contrato: {{provee: {cid}@1}})")
        for k in c.get("consumidores") or []:
            if k not in construccion:
                continue
            adopta = [f"{k}:{pid}" for pid, p in planes.get(k, {}).items()
                      if str((p.get("contrato") or {}).get("consume", "")).startswith(cid + "@")]
            if not adopta:
                err(f"{k}: ningún paso consume el contrato {cid} (contrato: {{consume: {cid}@1}})")
            for a in adopta:
                if publica and a in nodos and not set(publica) & alcanzables(nodos, a):
                    err(f"{a}: consume {cid} pero no espera al paso que lo publica ({', '.join(publica)})")


# ---------------------------------------------------------------- el manifiesto

def validar_manifiesto(ruta: Path):
    if not ruta.exists():
        err(f"No existe {ruta}")
        return
    try:
        m = yaml.safe_load(ruta.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        err(f"{ruta.name}: no es YAML válido ({e})")
        return
    if m.get("esquema") != "proyecto/v1":
        err("manifiesto: esquema debe ser proyecto/v1")
    slug = str(m.get("proyecto", ""))
    if not re.fullmatch(SLUG, slug):
        err(f"manifiesto: proyecto «{slug}» no sirve como slug")
    if not m.get("nombre"):
        err("manifiesto: falta nombre")
    repos = m.get("repos") or []
    if not repos:
        err("manifiesto: sin repos")
    vistos, bloques = set(), {}
    contratos = {str(c.get("id")): c for c in m.get("contratos") or []}
    for r in repos:
        rol = str(r.get("rol", ""))
        pref = f"manifiesto, {rol or '?'}"
        if not re.fullmatch(ROL, rol):
            err(f"{pref}: rol inválido")
        if rol in vistos:
            err(f"{pref}: rol repetido")
        vistos.add(rol)
        if r.get("nombre") != f"{slug}-{rol}":
            err(f"{pref}: el nombre debe ser {slug}-{rol}")
        if not re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+", str(r.get("github", ""))):
            err(f"{pref}: github va como cuenta/repo")
        if r.get("etapa") not in ETAPAS:
            err(f"{pref}: etapa construccion o mantenimiento")
        if r.get("etapa") == "mantenimiento" and "semilla" not in r:
            err(f"{pref}: en mantenimiento, semilla lleva la etiqueta congelada o null si nació sin semilla")
        p = r.get("puertos") or {}
        if "bloque" in p:
            b = p["bloque"]
            if b not in (1, 2, 3, 5, 6, 7, 8, 9):
                err(f"{pref}: el bloque de puertos es 1-9 y nunca 4")
            if b in bloques:
                err(f"{pref}: el bloque {b} ya es de {bloques[b]}")
            bloques[b] = rol
        elif "heredado" in p:
            h = p["heredado"] or {}
            for k in ("api", "base", "app"):
                if not isinstance(h.get(k), int):
                    err(f"{pref}: puertos.heredado necesita api, base y app como números")
        else:
            err(f"{pref}: puertos lleva bloque: N o heredado: {{api, base, app}}")
        for lado in ("provee", "consume"):
            for ref in r.get(lado) or []:
                mm = re.fullmatch(r"([a-z][a-z0-9-]{1,30})@(\d+)", str(ref))
                if not mm:
                    err(f"{pref}: {lado} va como <contrato>@<versión>")
                elif mm.group(1) not in contratos:
                    err(f"{pref}: {lado} nombra el contrato {mm.group(1)}, que no está en contratos")
    for cid, c in contratos.items():
        if c.get("proveedor") not in vistos:
            err(f"manifiesto: el contrato {cid} tiene un proveedor que no es un repo")
        for v in c.get("vigentes") or []:
            if not isinstance(v, int):
                err(f"manifiesto: el contrato {cid} lista versiones vigentes que no son números")
    texto_prohibido(ruta.read_text(encoding="utf-8"), ruta.name)


# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "--manifiesto":
        validar_manifiesto(Path(args[1]).expanduser())
    elif len(args) == 1 and not args[0].startswith("-"):
        validar_semilla(Path(args[0]).expanduser())
    else:
        sys.exit(__doc__)
    for a in avisos:
        print("AVISO  ", a)
    for e in errores:
        print("ERROR  ", e)
    print(f"\n{len(errores)} errores, {len(avisos)} avisos")
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
