"""Os juízes do Farol.

Quatro, com custos e latências muito diferentes:

  nuvem      API da Anthropic — mais capaz, mais caro, depende de internet
  local      VLM no PC da loja — A2.4
  comparacao embedding contra a base de conhecimento — A2.4
  detector   modelo de visão para contagem — A2.4

  simulado   não julga nada: serve para rodar o laço inteiro sem gastar
"""

from farol_agent.juizes.base import ErroDoJuiz, Juiz

__all__ = ["Juiz", "ErroDoJuiz"]
