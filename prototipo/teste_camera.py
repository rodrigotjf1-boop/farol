#!/usr/bin/env python3
"""
Teste Dirigido — valida UM canal do DVR + UM critério, ao vivo.
================================================================
Use para calibrar antes de confiar nos alertas:
  - captura um frame do canal escolhido
  - salva a foto analisada (para você ver o que a câmera enxergou)
  - manda para a IA com o critério e mostra o veredito na hora
  - pergunta se quer repetir (útil p/ testar "conforme" vs "nao conforme")

Uso:
  $env:ANTHROPIC_API_KEY="sua-chave"   (PowerShell)
  python teste_camera.py

Lê o config.yaml para pegar IP, usuário, senha e template do DVR.
"""

import base64
import os
import sys
from datetime import datetime
from pathlib import Path

import cv2
import yaml
from anthropic import Anthropic

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.yaml"
TESTE_DIR = BASE_DIR / "testes"

SYSTEM_PROMPT = (
    "Você é um auditor visual de conformidade operacional de uma hamburgueria. "
    "Analise a imagem da câmera de segurança e verifique APENAS o critério pedido. "
    "Seja objetivo e conservador: se a imagem não permitir concluir com razoável "
    "confiança, responda 'indeterminado'. "
    "Responda SOMENTE com JSON válido, sem markdown, no formato: "
    '{"status": "conforme" | "nao_conforme" | "indeterminado", '
    '"confianca": 0.0 a 1.0, "observacao": "explicação curta em pt-BR"}'
)


def carregar_config() -> dict:
    if not CONFIG_PATH.exists():
        sys.exit(f"ERRO: config.yaml não encontrado em {CONFIG_PATH}")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def capturar_frame(url_rtsp: str, tentativas: int = 3):
    for tentativa in range(1, tentativas + 1):
        cap = cv2.VideoCapture(url_rtsp, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, frame = cap.read()
        cap.release()
        if ok and frame is not None:
            return frame
        print(f"  ...tentativa {tentativa}/{tentativas} falhou, repetindo")
    return None


def frame_para_base64_jpeg(frame, qualidade=80, largura_max=1024) -> str:
    h, w = frame.shape[:2]
    if w > largura_max:
        escala = largura_max / w
        frame = cv2.resize(frame, (largura_max, int(h * escala)))
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
    return base64.b64encode(buf.tobytes()).decode("ascii")


def salvar_foto(frame, canal) -> Path:
    TESTE_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    caminho = TESTE_DIR / f"teste_canal{canal}_{ts}.jpg"
    cv2.imwrite(str(caminho), frame)
    return caminho


def analisar(client, modelo, img_b64, criterio) -> str:
    resp = client.messages.create(
        model=modelo, max_tokens=300, system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64",
             "media_type": "image/jpeg", "data": img_b64}},
            {"type": "text", "text": f"Critério a verificar: {criterio}"},
        ]}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def main():
    cfg = carregar_config()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ERRO: defina ANTHROPIC_API_KEY antes de rodar.")
    client = Anthropic(api_key=api_key)
    modelo = cfg.get("modelo_ia", "claude-sonnet-4-6")
    dvr = cfg["dvr"]

    print("=" * 55)
    print("TESTE DIRIGIDO DE CÂMERA — Ctrl+C para sair")
    print("=" * 55)

    # Mostra os setores/canais do config para facilitar
    print("\nSetores no config.yaml:")
    for s in cfg.get("setores", []):
        print(f"  canal {s['canal']:>2}  ->  {s['setor']}")
    print()

    while True:
        try:
            canal = input("Canal a testar (número): ").strip()
            if not canal:
                continue
            criterio = input("Critério (ou Enter p/ usar 'descreva o que vê'): ").strip()
            if not criterio:
                criterio = ("Descreva objetivamente o que aparece nesta imagem: "
                            "pessoas, se usam touca/luva, estado de limpeza das "
                            "superfícies e equipamentos visíveis.")

            url = dvr["url_rtsp_template"].format(
                usuario=dvr["usuario"], senha=dvr["senha"],
                ip=dvr["ip"], porta=dvr.get("porta", 554), canal=canal,
            )

            print(f"\n[capturando canal {canal}...]")
            frame = capturar_frame(url)
            if frame is None:
                print("❌ Não capturou frame. Verifique o canal e a conexão.\n")
                continue

            foto = salvar_foto(frame, canal)
            print(f"📸 Foto salva: {foto}")
            print("[analisando com a IA...]")
            veredito = analisar(client, modelo, frame_para_base64_jpeg(frame), criterio)
            print("\n--- VEREDITO DA IA ---")
            print(veredito)
            print("----------------------\n")
            print(f"(Abra a foto {foto.name} na pasta 'testes' para comparar "
                  "com o que a IA disse.)\n")
        except KeyboardInterrupt:
            print("\nTeste encerrado.")
            break
        except Exception as e:
            print(f"[erro] {e}\n")


if __name__ == "__main__":
    main()
