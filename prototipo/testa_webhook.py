#!/usr/bin/env python3
"""
Testa o webhook do n8n com um evento FAKE (sem precisar do DVR/IA).
Use para validar o roteamento no n8n isoladamente.

Uso:
  python testa_webhook.py "https://seu-n8n/webhook/monitor-visao"
  python testa_webhook.py "https://seu-n8n/webhook/monitor-visao" alta
  python testa_webhook.py "https://seu-n8n/webhook-test/monitor-visao" media

Dica: no n8n, o botão "Listen for test event" gera uma URL de TESTE
(/webhook-test/...). Use ela para ver o evento chegar na tela.
Depois de ativar o workflow, a URL de produção é /webhook/...
"""

import sys
import json
import uuid
from datetime import datetime

import requests

def evento_fake(urgencia="alta"):
    return {
        "evento_id": str(uuid.uuid4()),
        "origem": "monitor-visao",
        "versao_schema": "2.0",
        "timestamp": datetime.now().astimezone().isoformat(),
        "loja": {"id": "loja-01", "nome": "Mister Burguer"},
        "setor": {"nome": "Chapa / Grelha", "canal": 5},
        "verificacao": {
            "nome": "EPI na chapa",
            "criterio": "Verificar touca e calçado fechado",
        },
        "resultado": {
            "status": "nao_conforme",
            "confianca": 0.85,
            "observacao": "Funcionário sem touca e usando chinelo (teste fake).",
        },
        "urgencia_sugerida": urgencia,
        "snapshot_base64": None,
    }

def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: python testa_webhook.py <URL_DO_WEBHOOK> [alta|media|baixa]")
    url = sys.argv[1]
    urgencia = sys.argv[2] if len(sys.argv) > 2 else "alta"
    ev = evento_fake(urgencia)
    print(f"Enviando evento FAKE (urgência={urgencia}) para:\n  {url}\n")
    try:
        r = requests.post(url, json=ev, timeout=20)
        print(f"Status HTTP: {r.status_code}")
        print(f"Resposta: {r.text[:300]}")
        if 200 <= r.status_code < 300:
            print("\n✅ Webhook recebeu. Confira a execução no n8n.")
        else:
            print("\n⚠️ O webhook respondeu com erro. Verifique a URL e se o workflow está ativo/escutando.")
    except requests.RequestException as e:
        print(f"❌ Falha ao conectar: {e}")

if __name__ == "__main__":
    main()
