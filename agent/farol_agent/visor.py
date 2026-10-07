"""Os canais da loja no navegador do PC de análise.

Pedido do dono (07/10/2026): *"opção de deixar os canais rodando no PC de
análise, via navegador"*.

Uma página local, servida pelo próprio agente: o mosaico dos canais, cada um
com o nome e quantos critérios valem nele.

## A imagem não sai deste computador

O servidor escuta **só em 127.0.0.1**. Não há opção para abrir na rede: quem
está em outra máquina não alcança, e nada passa pela nuvem. É o mesmo que
olhar a tela do gravador — por isso aqui não há borrão de rosto.

Abrir isto na rede seria outra funcionalidade, com senha e com a conversa de
privacidade que ela pede. Não é um parâmetro esquecido.

## Só abre câmera enquanto alguém olha

O gravador tem limite de fluxos, e o cabo também. O canal é aberto quando a
página pede o primeiro quadro e fechado depois de alguns segundos sem pedido
— fechar a aba basta. Se a auditoria já tem o canal aberto, a página usa o
quadro dela em vez de abrir uma segunda conexão.

## Por que não é MJPEG

O navegador limita em seis as conexões simultâneas com o mesmo endereço. Um
mosaico de dezesseis fluxos contínuos mostraria seis e deixaria dez
esperando para sempre. Aqui cada quadro é um pedido curto, e a página pede o
próximo quando o anterior chega: dezesseis canais revezam as mesmas
conexões.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import threading
import time
from collections.abc import Callable
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import cv2

from farol_agent.configuracao import ConfigDaLoja, PontoConfig
from farol_agent.pipeline import qualidade

_log = logging.getLogger(__name__)

PORTA_PADRAO = 8765
# A única interface. Ver o cabeçalho do módulo.
ENDERECO = "127.0.0.1"

# Sem pedido por este tempo, o canal é fechado.
OCIOSO_SEG = 20.0
# Qualidade do JPEG do mosaico: é para olhar, não para julgar.
JPEG = 70
# "Tem cena?" custa alguns milissegundos; uma vez por segundo por canal basta.
CONFERIR_CENA_A_CADA_SEG = 1.0


class _Canal:
    """Um canal aberto para a página: o leitor e o último JPEG pronto."""

    def __init__(self, leitor: Any) -> None:
        self.leitor = leitor
        self.ultimo_pedido = time.monotonic()
        self.ts_do_jpeg: datetime | None = None
        self.jpeg: bytes | None = None
        self.estado = "abrindo"
        self.detalhe = ""
        self.cena_conferida_em = 0.0


def _leitor_rtsp(ponto: PontoConfig):
    # Importação tardia: `servico` importa o cofre, e o teste do visor não
    # precisa de nenhum dos dois.
    from farol_agent.fontes.rtsp import _LeitorContinuo
    from farol_agent.servico import url_do_ponto

    # A URL leva a senha embutida e não é registrada em lugar nenhum.
    leitor = _LeitorContinuo(
        url_do_ponto(ponto, sub=True), f"visor-{ponto.id}",
        (ponto.host, int(ponto.porta or 554)) if ponto.host else None,
    )
    leitor.iniciar()
    return leitor


class Canais:
    """Os canais que a página está olhando agora.

    `emprestado(ponto_id)` devolve `(quando, imagem)` se alguém — a auditoria
    — já tiver aquele canal aberto. É o que evita a segunda conexão.
    """

    def __init__(
        self,
        config_atual: Callable[[], ConfigDaLoja | None],
        *,
        abrir: Callable[[PontoConfig], Any] = _leitor_rtsp,
        emprestado: Callable[[str], tuple[datetime, Any] | None] | None = None,
        ocioso_seg: float = OCIOSO_SEG,
    ) -> None:
        self._config_atual = config_atual
        self._abrir = abrir
        self._emprestado = emprestado
        self._ocioso_seg = ocioso_seg
        self._abertos: dict[str, _Canal] = {}
        self._trava = threading.Lock()

    # ───────────────────────── o que a página pede ─────────────────────────

    def lista(self) -> dict[str, Any]:
        """O que a página precisa para montar o mosaico. Nada além disso:
        endereço do gravador e usuário não saem daqui."""
        config = self._config_atual()
        if config is None:
            return {"loja": None, "canais": []}
        canais = [
            {
                "id": p.id,
                "nome": p.nome,
                "canal": p.canal,
                "setor": p.setor,
                "criterios": len(p.regras),
            }
            for p in config.pontos
        ]
        canais.sort(key=lambda c: (c["canal"] is None, c["canal"] or 0, c["nome"]))
        return {"loja": config.loja_nome, "canais": canais}

    def quadro(self, ponto_id: str) -> tuple[bytes | None, str, str] | None:
        """`(jpeg, estado, detalhe)` do canal, ou `None` se ele não existe.

        Estados: `ok`, `sem_sinal` (há imagem, mas não há cena), `abrindo`
        (ainda sem quadro) e `erro` (não deu para abrir; o detalhe diz).
        """
        config = self._config_atual()
        ponto = config.ponto(ponto_id) if config else None
        if ponto is None:
            return None

        if self._emprestado is not None:
            try:
                atual = self._emprestado(ponto_id)
            except Exception:  # noqa: BLE001 — quem empresta não pode derrubar a página
                atual = None
            if atual is not None:
                proprio = None
                with self._trava:
                    canal = self._abertos.get(ponto_id)
                    if canal is None:
                        # Sem leitor próprio: o quadro vem de quem emprestou.
                        canal = self._abertos[ponto_id] = _Canal(None)
                    elif canal.leitor is not None:
                        # A auditoria passou a ter este canal: a conexão que
                        # a página tinha aberto deixa de ser necessária.
                        proprio, canal.leitor = canal.leitor, None
                if proprio is not None:
                    try:
                        proprio.parar()
                    except Exception:  # noqa: BLE001
                        _log.debug("não consegui parar o leitor do canal %s", ponto_id)
                canal.ultimo_pedido = time.monotonic()
                self._preparar(canal, atual)
                return canal.jpeg, canal.estado, canal.detalhe

        with self._trava:
            canal = self._abertos.get(ponto_id)
            if canal is None or canal.leitor is None:
                try:
                    leitor = self._abrir(ponto)
                except Exception as e:  # noqa: BLE001
                    # Senha ausente, ponto sem endereço: a mensagem dessas
                    # exceções não leva segredo, e é ela que diz o que fazer.
                    return None, "erro", str(e)
                canal = self._abertos[ponto_id] = _Canal(leitor)
        canal.ultimo_pedido = time.monotonic()

        atual = canal.leitor.ultimo()
        if atual is None:
            # O leitor sabe por que não há imagem (o gravador não respondeu,
            # o canal não abriu). "Abrindo…" para sempre não diz a ninguém
            # que o cadastro do canal está errado.
            motivo = getattr(canal.leitor, "ultimo_erro", None)
            if motivo:
                return None, "erro", f"{motivo} — confira o cadastro deste canal no console"
            if canal.jpeg is None:
                return None, "abrindo", ""
            # Havia imagem e o fluxo parou: dizer isso é melhor que congelar
            # o último quadro como se fosse de agora.
            return None, "abrindo", "o fluxo parou; religando"
        self._preparar(canal, atual)
        return canal.jpeg, canal.estado, canal.detalhe

    def _preparar(self, canal: _Canal, atual: tuple[datetime, Any]) -> None:
        quando, imagem = atual
        if canal.ts_do_jpeg == quando and canal.jpeg is not None:
            return   # o mesmo quadro: o JPEG já está pronto
        ok, buffer = cv2.imencode(".jpg", imagem, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG])
        if not ok:
            return
        canal.jpeg = buffer.tobytes()
        canal.ts_do_jpeg = quando

        agora = time.monotonic()
        if agora - canal.cena_conferida_em >= CONFERIR_CENA_A_CADA_SEG:
            canal.cena_conferida_em = agora
            utilizavel, porque = qualidade.cena_utilizavel(imagem)
            canal.estado = "ok" if utilizavel else "sem_sinal"
            canal.detalhe = "" if utilizavel else porque

    # ───────────────────────────── faxina ─────────────────────────────

    def aposentar_ociosos(self) -> int:
        """Fecha o que ninguém olha, e o que saiu da configuração."""
        config = self._config_atual()
        existentes = {p.id for p in config.pontos} if config else set()
        agora = time.monotonic()
        with self._trava:
            saem = [
                (pid, c)
                for pid, c in self._abertos.items()
                if pid not in existentes or agora - c.ultimo_pedido > self._ocioso_seg
            ]
            for pid, _ in saem:
                del self._abertos[pid]
        # Fora da trava: parar um leitor espera a thread dele.
        for pid, c in saem:
            self._parar(pid, c)
        return len(saem)

    def abertos(self) -> list[str]:
        with self._trava:
            return [pid for pid, c in self._abertos.items() if c.leitor is not None]

    def fechar(self) -> None:
        with self._trava:
            todos = list(self._abertos.items())
            self._abertos.clear()
        for pid, c in todos:
            self._parar(pid, c)

    @staticmethod
    def _parar(ponto_id: str, canal: _Canal) -> None:
        if canal.leitor is None:
            return
        try:
            canal.leitor.parar()
        except Exception:  # noqa: BLE001
            _log.debug("não consegui parar o leitor do canal %s", ponto_id)


# ───────────────────────────── a página ─────────────────────────────

PAGINA = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Farol — canais desta loja</title>
<style>
  :root { --fundo:#0b0f14; --painel:#121922; --borda:#223041; --tinta:#e8eef5; --suave:#8fa0b3;
          --facho:#e2a340; --ok:#3fbf7f; --atencao:#e0a13a; --critico:#e05a5a; }
  * { box-sizing: border-box; }
  html, body { margin:0; background:var(--fundo); color:var(--tinta);
               font: 14px/1.4 system-ui, "Segoe UI", sans-serif; }
  header { display:flex; flex-wrap:wrap; align-items:baseline; gap:.5rem 1rem;
           padding:.75rem 1rem; border-bottom:1px solid var(--borda); }
  header h1 { margin:0; font-size:1rem; font-weight:600; }
  header span { color:var(--suave); }
  main { padding:1rem; }
  #mosaico { display:grid; gap:.75rem; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  #mosaico.um { grid-template-columns: 1fr; }
  figure { margin:0; background:var(--painel); border:1px solid var(--borda); border-radius:.6rem;
           overflow:hidden; }
  figure button { all:unset; display:block; width:100%; cursor:pointer; position:relative;
                  aspect-ratio: 704 / 480; background:#000; }
  figure button:focus-visible { outline:2px solid var(--facho); outline-offset:-2px; }
  figure img { display:block; width:100%; height:100%; object-fit:contain; }
  figure img[hidden] { display:none; }
  figure .aviso { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                  padding:1rem; text-align:center; color:var(--suave); background:rgba(0,0,0,.55); }
  figure .aviso[hidden] { display:none; }
  figcaption { display:flex; flex-wrap:wrap; align-items:center; gap:.25rem .5rem; padding:.5rem .75rem; }
  figcaption strong { font-weight:600; }
  .selo { font-size:.75rem; padding:.05rem .4rem; border-radius:.3rem; background:rgba(143,160,179,.18);
          color:var(--suave); }
  .selo.auditado { background:rgba(63,191,127,.15); color:var(--ok); }
  .selo.problema { background:rgba(224,161,58,.15); color:var(--atencao); }
  #vazio { color:var(--suave); max-width:60ch; }
  footer { padding:1rem; color:var(--suave); font-size:.8rem; border-top:1px solid var(--borda); }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style>
</head>
<body>
<header>
  <h1>Farol — canais desta loja</h1>
  <span id="loja"></span>
  <span id="resumo"></span>
</header>
<main>
  <p id="vazio" hidden></p>
  <div id="mosaico"></div>
</main>
<footer>
  As imagens ficam neste computador: esta página só abre aqui, e nada passa pela internet.
  Clique num canal para ampliar. Os canais são abertos enquanto esta aba está visível.
</footer>
<script>
const INTERVALO = 250;            // ms entre quadros de cada canal
const mosaico = document.getElementById('mosaico');
const vazio = document.getElementById('vazio');
const telas = new Map();          // id do canal -> {figure, img, aviso, selo, ativo}
let ampliado = null;

const AVISOS = {
  abrindo: 'abrindo o canal…',
  erro: 'não foi possível abrir este canal',
  sem_resposta: 'o agente não respondeu',
};

function rotulo(c) { return (c.canal ? 'Canal ' + c.canal + ' · ' : '') + c.nome; }

function criar(c) {
  const figure = document.createElement('figure');
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.setAttribute('aria-pressed', 'false');
  botao.title = 'Ampliar ou voltar ao mosaico';
  const img = document.createElement('img');
  img.alt = rotulo(c);
  img.hidden = true;              // só aparece quando chega o primeiro quadro
  const aviso = document.createElement('div');
  aviso.className = 'aviso';
  aviso.textContent = AVISOS.abrindo;
  botao.append(img, aviso);
  const legenda = document.createElement('figcaption');
  const nome = document.createElement('strong');
  const usos = document.createElement('span');
  const selo = document.createElement('span');
  selo.className = 'selo problema';
  selo.hidden = true;
  legenda.append(nome, usos, selo);
  figure.append(botao, legenda);
  const tela = { figure, botao, img, aviso, nome, usos, selo, ativo: true, url: null };
  botao.addEventListener('click', () => ampliar(c.id));
  telas.set(c.id, tela);
  mosaico.append(figure);
  ciclo(c.id);
  return tela;
}

function atualizar(tela, c) {
  tela.nome.textContent = rotulo(c);
  tela.img.alt = rotulo(c);
  tela.usos.className = 'selo' + (c.criterios > 0 ? ' auditado' : '');
  tela.usos.textContent = c.criterios === 0 ? 'sem critério'
    : c.criterios === 1 ? '1 critério' : c.criterios + ' critérios';
}

function ampliar(id) {
  ampliado = ampliado === id ? null : id;
  mosaico.classList.toggle('um', ampliado !== null);
  for (const [outro, tela] of telas) {
    tela.figure.hidden = ampliado !== null && outro !== ampliado;
    tela.botao.setAttribute('aria-pressed', String(outro === ampliado));
  }
}

async function ciclo(id) {
  const tela = telas.get(id);
  if (!tela || !tela.ativo) return;
  let espera = INTERVALO;
  // Aba escondida ou canal fora da vista: não pede — e o agente fecha o canal.
  if (document.hidden || tela.figure.hidden) {
    setTimeout(() => ciclo(id), 500);
    return;
  }
  const inicio = performance.now();
  try {
    const r = await fetch('/canal/' + encodeURIComponent(id) + '.jpg', { cache: 'no-store' });
    const estado = r.headers.get('X-Farol-Estado') || '';
    const detalhe = decodeURIComponent(r.headers.get('X-Farol-Detalhe') || '');
    if (r.ok) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      tela.img.src = url;
      tela.img.hidden = false;
      if (tela.url) URL.revokeObjectURL(tela.url);
      tela.url = url;
      tela.aviso.hidden = true;
      tela.selo.hidden = estado !== 'sem_sinal';
      tela.selo.textContent = 'sem sinal';
      tela.selo.title = detalhe;
    } else {
      tela.aviso.hidden = false;
      tela.aviso.textContent = (AVISOS[estado] || AVISOS.erro) + (detalhe ? ' — ' + detalhe : '');
      espera = 1000;
    }
  } catch (e) {
    tela.aviso.hidden = false;
    tela.aviso.textContent = AVISOS.sem_resposta;
    espera = 2000;
  }
  setTimeout(() => ciclo(id), Math.max(0, espera - (performance.now() - inicio)));
}

async function listar() {
  try {
    const r = await fetch('/canais.json', { cache: 'no-store' });
    const d = await r.json();
    document.getElementById('loja').textContent = d.loja || '';
    const ids = new Set(d.canais.map((c) => c.id));
    for (const [id, tela] of telas) {
      if (!ids.has(id)) { tela.ativo = false; tela.figure.remove(); telas.delete(id); }
    }
    for (const c of d.canais) atualizar(telas.get(c.id) || criar(c), c);
    const n = d.canais.length;
    document.getElementById('resumo').textContent = n === 1 ? '1 canal' : n + ' canais';
    vazio.hidden = n > 0;
    vazio.textContent = n > 0 ? '' :
      'Esta loja ainda não tem canal cadastrado. Cadastre no console do Farol; eles aparecem aqui sozinhos.';
  } catch (e) {
    vazio.hidden = false;
    vazio.textContent = 'O agente não respondeu. Ele está rodando neste computador?';
  }
}

listar();
setInterval(listar, 10000);
</script>
</body>
</html>
"""


def _impressao(marca: str) -> str:
    """O `sha256` do conteúdo do único `<style>` ou `<script>` da página."""
    (conteudo,) = re.findall(rf"<{marca}>(.*?)</{marca}>", PAGINA, flags=re.S)
    return base64.b64encode(hashlib.sha256(conteudo.encode("utf-8")).digest()).decode("ascii")


# O navegador só executa o script e o estilo que ESTÃO nesta página, e só
# fala com este endereço. Não é desconfiança da página — é o que impede uma
# extensão ou um antivírus de pendurar um script de fora nela: no notebook
# de desenvolvimento, o antivírus injetava o dele em toda página HTTP.
POLITICA = (
    "default-src 'none'; img-src 'self' blob:; connect-src 'self'; "
    f"style-src 'sha256-{_impressao('style')}'; script-src 'sha256-{_impressao('script')}'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


def _tratador(canais: Canais, porta: Callable[[], int]):
    class Tratador(BaseHTTPRequestHandler):
        server_version = "FarolVisor"
        protocol_version = "HTTP/1.1"

        # O log padrão escreve uma linha por pedido no stderr: com dezesseis
        # canais a quatro quadros por segundo, afogaria o log do agente.
        def log_message(self, formato: str, *args: Any) -> None:  # noqa: A003
            return

        def _responder(self, codigo: int, tipo: str, corpo: bytes, extras: dict[str, str] | None = None) -> None:
            self.send_response(codigo)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for k, v in (extras or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(corpo)

        def _texto(self, codigo: int, mensagem: str, extras: dict[str, str] | None = None) -> None:
            self._responder(codigo, "text/plain; charset=utf-8", mensagem.encode("utf-8"), extras)

        def _host_local(self) -> bool:
            # Só atende quem pediu por 127.0.0.1 ou localhost. Uma página da
            # internet pode fazer o navegador pedir a este endereço usando
            # um nome que ela controla; o nome chega aqui, e é recusado.
            host = (self.headers.get("Host") or "").strip().lower()
            return host in {f"127.0.0.1:{porta()}", f"localhost:{porta()}"}

        def do_GET(self) -> None:  # noqa: N802 — nome que o http.server exige
            if not self._host_local():
                self._texto(403, "esta página só abre neste computador")
                return

            caminho = self.path.split("?", 1)[0]
            if caminho == "/":
                self._responder(
                    200, "text/html; charset=utf-8", PAGINA.encode("utf-8"),
                    {"Content-Security-Policy": POLITICA},
                )
                return
            if caminho == "/favicon.ico":
                # Sem ícone. Responder "nada" evita um 404 por abertura no
                # console do navegador, que parece defeito para quem olha.
                self._responder(204, "image/x-icon", b"")
                return
            if caminho == "/canais.json":
                corpo = json.dumps(canais.lista(), ensure_ascii=False).encode("utf-8")
                self._responder(200, "application/json; charset=utf-8", corpo)
                return
            if caminho.startswith("/canal/") and caminho.endswith(".jpg"):
                from urllib.parse import quote, unquote

                ponto_id = unquote(caminho[len("/canal/"):-len(".jpg")])
                r = canais.quadro(ponto_id)
                if r is None:
                    self._texto(404, "canal não encontrado")
                    return
                jpeg, estado, detalhe = r
                extras = {"X-Farol-Estado": estado, "X-Farol-Detalhe": quote(detalhe)}
                if jpeg is None:
                    self._texto(503, estado, extras)
                    return
                self._responder(200, "image/jpeg", jpeg, extras)
                return
            self._texto(404, "não encontrado")

        do_HEAD = do_GET  # noqa: N815

    return Tratador


class Visor:
    """O servidor local do mosaico. Nunca derruba o agente: se a porta
    estiver ocupada, registra e segue sem a página."""

    def __init__(
        self,
        config_atual: Callable[[], ConfigDaLoja | None],
        *,
        porta: int = PORTA_PADRAO,
        emprestado: Callable[[str], tuple[datetime, Any] | None] | None = None,
        abrir: Callable[[PontoConfig], Any] = _leitor_rtsp,
        ocioso_seg: float = OCIOSO_SEG,
    ) -> None:
        self.canais = Canais(config_atual, abrir=abrir, emprestado=emprestado, ocioso_seg=ocioso_seg)
        self._porta_pedida = porta
        self._servidor: ThreadingHTTPServer | None = None
        self._parar = threading.Event()
        self._threads: list[threading.Thread] = []

    @property
    def porta(self) -> int:
        return self._servidor.server_address[1] if self._servidor else self._porta_pedida

    @property
    def endereco(self) -> str:
        return f"http://{ENDERECO}:{self.porta}"

    def iniciar(self) -> bool:
        try:
            self._servidor = ThreadingHTTPServer(
                (ENDERECO, self._porta_pedida), _tratador(self.canais, lambda: self.porta)
            )
        except OSError as e:
            _log.warning(
                "não abri a página dos canais na porta %s (%s). O agente segue sem ela.",
                self._porta_pedida, e,
            )
            return False
        self._servidor.daemon_threads = True
        self._threads = [
            threading.Thread(target=self._servidor.serve_forever, name="visor-http", daemon=True),
            threading.Thread(target=self._faxina, name="visor-faxina", daemon=True),
        ]
        for t in self._threads:
            t.start()
        _log.info("canais no navegador deste computador: %s", self.endereco)
        return True

    def _faxina(self) -> None:
        while not self._parar.wait(5.0):
            try:
                self.canais.aposentar_ociosos()
            except Exception:  # noqa: BLE001
                _log.exception("faxina do visor falhou; sigo")

    def parar(self) -> None:
        self._parar.set()
        if self._servidor is not None:
            self._servidor.shutdown()
            self._servidor.server_close()
            self._servidor = None
        self.canais.fechar()
