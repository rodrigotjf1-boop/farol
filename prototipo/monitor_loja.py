#!/usr/bin/env python3
"""
Monitor de Visão — Regem / Hamburgueria (v3, por setores)
=========================================================
Serviço de DETECÇÃO. Captura frames do DVR via RTSP, analisa conformidade
de tarefas com IA (Claude) e EMITE EVENTOS estruturados para o Regem via
webhook do n8n. O roteamento (KDS, dashboard do gerente/presidente,
WhatsApp de urgência) é responsabilidade do Regem/n8n — este serviço só
produz os eventos.

Fluxo:
  DVR (RTSP) -> frame -> Claude Vision -> evento JSON -> webhook n8n -> Regem

Saída principal : webhook n8n (POST HTTP com JSON)
Saída opcional  : Telegram (apenas para depuração local; desligável)

Uso:
  1. Configure config.yaml
  2. $env:ANTHROPIC_API_KEY="sua-chave"   (PowerShell)
  3. python monitor_loja.py

Requisitos: pip install -r requirements.txt
"""

import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime, time as dtime
from pathlib import Path

import cv2
import requests
import yaml
from anthropic import Anthropic

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.yaml"
SNAPSHOT_DIR = BASE_DIR / "snapshots"
LOG_PATH = BASE_DIR / "historico.jsonl"
FILA_PENDENTES = BASE_DIR / "eventos_pendentes.jsonl"  # buffer se o n8n cair


def carregar_config() -> dict:
    if not CONFIG_PATH.exists():
        sys.exit(f"ERRO: config.yaml não encontrado em {CONFIG_PATH}")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ----------------------------------------------------------------------
# Captura de frame do DVR (RTSP)
# ----------------------------------------------------------------------

def capturar_frame(url_rtsp: str, tentativas: int = 3):
    """Abre o stream RTSP, lê um frame e fecha. Retorna None se falhar."""
    for tentativa in range(1, tentativas + 1):
        cap = cv2.VideoCapture(url_rtsp, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, frame = cap.read()
        cap.release()
        if ok and frame is not None:
            return frame
        print(f"  [aviso] Falha na captura (tentativa {tentativa}/{tentativas})")
        time.sleep(2)
    return None


def frame_para_base64_jpeg(frame, qualidade: int = 80, largura_max: int = 1024) -> str:
    h, w = frame.shape[:2]
    if w > largura_max:
        escala = largura_max / w
        frame = cv2.resize(frame, (largura_max, int(h * escala)))
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
    if not ok:
        raise RuntimeError("Falha ao codificar frame em JPEG")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def salvar_snapshot(frame, nome_tarefa: str) -> Path:
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    caminho = SNAPSHOT_DIR / f"{ts}_{nome_tarefa}.jpg"
    cv2.imwrite(str(caminho), frame)
    return caminho


# ----------------------------------------------------------------------
# Análise com Claude (API Anthropic)
# ----------------------------------------------------------------------

SYSTEM_PROMPT = (
    "Você é um auditor visual de conformidade operacional de uma hamburgueria. "
    "Analise a imagem da câmera de segurança e verifique APENAS o critério pedido. "
    "Seja objetivo e conservador: se a imagem não permitir concluir com razoável "
    "confiança, responda 'indeterminado'. "
    "Responda SOMENTE com JSON válido, sem markdown, no formato: "
    '{"status": "conforme" | "nao_conforme" | "indeterminado", '
    '"confianca": 0.0 a 1.0, "observacao": "explicação curta em pt-BR"}'
)


def analisar_frame(client: Anthropic, modelo: str, img_b64: str, criterio: str) -> dict:
    resposta = client.messages.create(
        model=modelo,
        max_tokens=300,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": img_b64,
                        },
                    },
                    {"type": "text", "text": f"Critério a verificar: {criterio}"},
                ],
            }
        ],
    )
    texto = "".join(b.text for b in resposta.content if b.type == "text").strip()
    texto = texto.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        return {
            "status": "indeterminado",
            "confianca": 0.0,
            "observacao": f"Resposta não parseável: {texto[:200]}",
        }


# ----------------------------------------------------------------------
# Construção e envio do EVENTO para o Regem (via webhook n8n)
# ----------------------------------------------------------------------

def construir_evento(cfg: dict, setor: dict, verif: dict, resultado: dict,
                     img_b64: "str | None") -> dict:
    """
    Contrato de evento entre o Monitor de Visão e o Regem.
    Este JSON é a interface estável — o n8n/Regem consome estes campos.
    Organizado por SETOR (área física = canal) + VERIFICAÇÃO.
    """
    return {
        "evento_id": str(uuid.uuid4()),
        "origem": "monitor-visao",
        "versao_schema": "2.0",
        "timestamp": datetime.now().astimezone().isoformat(),
        "loja": {
            "id": cfg.get("loja", {}).get("id", "loja-01"),
            "nome": cfg.get("loja", {}).get("nome", "Hamburgueria"),
        },
        "setor": {
            "nome": setor["setor"],
            "canal": setor["canal"],
        },
        "verificacao": {
            "nome": verif["nome"],
            "criterio": verif["criterio"].strip(),
        },
        "resultado": {
            "status": resultado.get("status", "indeterminado"),
            "confianca": float(resultado.get("confianca", 0.0)),
            "observacao": resultado.get("observacao", ""),
        },
        # Sugestão de urgência; a DECISÃO final de roteamento é do Regem/n8n
        "urgencia_sugerida": verif.get("urgencia", "media"),
        "snapshot_base64": img_b64,  # jpeg base64 (ou None se não anexado)
    }


def registrar_pendente(evento: dict):
    """Guarda o evento em disco se o envio falhar, para reenvio posterior."""
    evento_sem_img = {**evento, "snapshot_base64": None}  # não incha o buffer
    with open(FILA_PENDENTES, "a", encoding="utf-8") as f:
        f.write(json.dumps(evento_sem_img, ensure_ascii=False) + "\n")


def enviar_evento_n8n(cfg_n8n: dict, evento: dict) -> bool:
    """POST do evento para o webhook do n8n. Retorna True se aceito."""
    url = (cfg_n8n.get("webhook_url") or "").strip()
    if not url or url.startswith("COLE_AQUI"):
        print("  [n8n] webhook_url não configurada — evento não enviado.")
        return False

    headers = {"Content-Type": "application/json"}
    token = cfg_n8n.get("token")  # opcional: header de autenticação
    if token:
        headers[cfg_n8n.get("header_auth", "Authorization")] = token

    try:
        r = requests.post(url, json=evento, headers=headers,
                          timeout=cfg_n8n.get("timeout", 20))
        if 200 <= r.status_code < 300:
            print(f"  [n8n] evento enviado ({r.status_code})")
            return True
        print(f"  [n8n] webhook respondeu {r.status_code}: {r.text[:150]}")
        return False
    except requests.RequestException as e:
        print(f"  [n8n] falha de rede ao enviar: {e}")
        return False


# ----------------------------------------------------------------------
# Telegram (OPCIONAL — só depuração local; controlado por config)
# ----------------------------------------------------------------------

def notificar_telegram(cfg_tg: dict, mensagem: str, foto: "Path | None" = None):
    if not cfg_tg or not cfg_tg.get("ativo", False):
        return
    token = cfg_tg.get("bot_token", "")
    chat_id = cfg_tg.get("chat_id", "")
    if not token or token.startswith("123456"):
        return
    try:
        if foto and foto.exists():
            with open(foto, "rb") as f:
                requests.post(
                    f"https://api.telegram.org/bot{token}/sendPhoto",
                    data={"chat_id": chat_id, "caption": mensagem},
                    files={"photo": f}, timeout=30,
                )
        else:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data={"chat_id": chat_id, "text": mensagem}, timeout=30,
            )
    except requests.RequestException as e:
        print(f"  [telegram] falha: {e}")


# ----------------------------------------------------------------------
# Regras de horário e histórico
# ----------------------------------------------------------------------

def dentro_da_janela(janela: "str | None") -> bool:
    if not janela:
        return True
    inicio_s, fim_s = janela.split("-")
    h1, m1 = map(int, inicio_s.split(":"))
    h2, m2 = map(int, fim_s.split(":"))
    agora = datetime.now().time()
    return dtime(h1, m1) <= agora <= dtime(h2, m2)


def registrar_historico(registro: dict):
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------------
# Decisão de emissão
# ----------------------------------------------------------------------

def deve_emitir(cfg: dict, verif: dict, resultado: dict) -> bool:
    """
    Define se o evento vai para o Regem. Por padrão emite quando
    'nao_conforme' com confiança suficiente. Se emitir_sempre=True
    (na verificação ou global), emite todo veredito — útil para
    dashboards que querem registrar também as conformidades.
    """
    if verif.get("emitir_sempre", cfg.get("emitir_sempre", False)):
        return resultado.get("status") != "indeterminado"
    confianca_min = verif.get("confianca_minima", 0.7)
    return (
        resultado.get("status") == "nao_conforme"
        and float(resultado.get("confianca", 0)) >= confianca_min
    )


# ----------------------------------------------------------------------
# Loop principal
# ----------------------------------------------------------------------

def verificacoes_ativas_agora(setor: dict) -> list:
    """Retorna as verificações do setor que estão ativas e na janela de horário."""
    ativas = []
    for v in setor.get("verificacoes", []):
        if not v.get("ativa", True):
            continue
        if not dentro_da_janela(v.get("janela_horario")):
            continue
        ativas.append(v)
    return ativas


def executar_ciclo(cfg: dict, client: Anthropic):
    modelo = cfg.get("modelo_ia", "claude-sonnet-4-6")
    dvr = cfg["dvr"]
    anexar_snapshot = cfg.get("anexar_snapshot_no_evento", True)

    for setor in cfg["setores"]:
        pendentes = verificacoes_ativas_agora(setor)
        if not pendentes:
            continue  # nada a checar neste setor agora; não gasta captura

        canal = setor["canal"]
        nome_setor = setor["setor"]
        url = dvr["url_rtsp_template"].format(
            usuario=dvr["usuario"], senha=dvr["senha"],
            ip=dvr["ip"], porta=dvr.get("porta", 554), canal=canal,
        )

        print(f"[{datetime.now():%H:%M:%S}] Setor: {nome_setor} (canal {canal}) "
              f"— {len(pendentes)} verificação(ões)")

        # Captura UMA vez por setor e reaproveita o frame p/ todas as verificações
        frame = capturar_frame(url)
        if frame is None:
            print("  [erro] Sem frame do DVR.")
            evento_falha = {
                "evento_id": str(uuid.uuid4()),
                "origem": "monitor-visao",
                "versao_schema": "2.0",
                "timestamp": datetime.now().astimezone().isoformat(),
                "loja": cfg.get("loja", {"id": "loja-01"}),
                "setor": {"nome": nome_setor, "canal": canal},
                "tipo": "falha_captura",
                "urgencia_sugerida": "baixa",
                "resultado": {"observacao": "Não foi possível capturar frame."},
            }
            if not enviar_evento_n8n(cfg.get("n8n", {}), evento_falha):
                registrar_pendente(evento_falha)
            continue

        img_b64 = frame_para_base64_jpeg(frame)

        for verif in pendentes:
            nome_v = verif["nome"]
            resultado = analisar_frame(client, modelo, img_b64, verif["criterio"])

            registrar_historico({
                "timestamp": datetime.now().isoformat(),
                "setor": nome_setor, "canal": canal,
                "verificacao": nome_v, **resultado,
            })
            print(f"    [{nome_v}] -> {resultado.get('status')} "
                  f"({resultado.get('confianca', '?')}): "
                  f"{resultado.get('observacao', '')}")

            if not deve_emitir(cfg, verif, resultado):
                continue

            img_evento = img_b64 if anexar_snapshot else None
            evento = construir_evento(cfg, setor, verif, resultado, img_evento)
            if not enviar_evento_n8n(cfg.get("n8n", {}), evento):
                registrar_pendente(evento)

            if resultado.get("status") == "nao_conforme":
                foto = salvar_snapshot(frame, f"{nome_setor}_{nome_v}".replace(" ", "_"))
                notificar_telegram(
                    cfg.get("telegram", {}),
                    f"[DEBUG] {nome_setor} — {nome_v}: NÃO CONFORME\n"
                    f"{resultado.get('observacao', '')}",
                    foto,
                )


def main():
    cfg = carregar_config()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ERRO: defina a variável de ambiente ANTHROPIC_API_KEY")
    client = Anthropic(api_key=api_key)

    intervalo = cfg.get("intervalo_segundos", 300)
    webhook_ok = (cfg.get("n8n", {}).get("webhook_url") or "").startswith("http")
    print("=" * 55)
    print("Monitor de Visão — produtor de eventos para o Regem")
    print(f"Ciclo a cada {intervalo}s | webhook n8n: "
          f"{'configurado' if webhook_ok else 'NÃO configurado'}")
    print("Ctrl+C para sair.")
    print("=" * 55)

    while True:
        try:
            executar_ciclo(cfg, client)
        except KeyboardInterrupt:
            print("\nEncerrado pelo usuário.")
            break
        except Exception as e:
            print(f"[erro geral] {e}")
        time.sleep(intervalo)


if __name__ == "__main__":
    main()
