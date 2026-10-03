# Farol

**Auditoria de processo por visão computacional.**
*O padrão não pode depender de quem está olhando.*

Produto da DMS Tecnologia · [monitorfarol.com.br](https://monitorfarol.com.br)

---

## O que é

O Farol usa as câmeras que já existem na loja para verificar se o processo foi
executado conforme o padrão, e avisa quem decide quando sai do padrão.

Não é um NVR com IA. NVR responde *"entrou alguém?"*. O Farol responde
*"o processo foi executado conforme o padrão?"*.

## Estrutura

```
api/        NestJS + Drizzle + Postgres   · console e agente consomem
web/        Next.js 14 App Router         · console multi-loja
agent/      Python + FastAPI              · roda na loja, empacotado .exe
mcp/        servidor MCP                  · expõe o Farol à linha DMS
database/   migrations SQL numeradas
docs/       especificação, arquitetura, decisões
prototipo/  o script original que provou o conceito (referência histórica)
```

## As três camadas

| Camada | Onde roda | Configurável |
|---|---|---|
| Console | Nuvem — VPS com EasyPanel | não |
| Agente | **Sempre na loja** | não |
| Julgamento | Nuvem ou local | **sim** — `loja.modo_julgamento` |

Três das cinco categorias de regra — presença, contagem e comparação com padrão
— nunca chegam à nuvem. Nas duas que chegam, o que trafega é um recorte da zona,
nunca o vídeo, nunca o quadro inteiro, nunca áudio.

## As cinco categorias de regra

| Tipo | Exemplo | Motor | Custo por análise |
|---|---|---|---|
| `presenca` | chegada ao setor, tempo fora do posto | detector local | R$ 0 |
| `contagem` | fila, ocupação, pico por horário | detector local | R$ 0 |
| `comparacao` | fechamento, bancada organizada | embedding local | ≈ R$ 0 |
| `estado` | touca, luva, bancada limpa | VLM | R$ 0,0006 a 0,006 |
| `acao` | procedimento de limpeza, montagem | VLM em série | 6 a 10× |

## Prioridade decide a rota

| Prioridade | Prazo | Onde | Efeito |
|---|---|---|---|
| `urgente` | < 2 s | modelo local | nuvem não alcança: a rede sozinha gasta 2 a 5 s |
| `intermediaria` | até 30 s | API, chamada normal | preço de tabela |
| `leve` | horas | API, em lote | **metade do preço** |

## Estado

Em construção — Bloco A, etapa A1 (fundação e contrato).
Roadmap e decisões em [`docs/`](docs/).

## Licenças

Só MIT, Apache 2.0 e BSD no que for distribuído. Ver `docs/licencas.md` para as
armadilhas mapeadas — há seis que inviabilizam produto revendido.
