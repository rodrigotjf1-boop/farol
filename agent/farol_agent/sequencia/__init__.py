"""A sequência: olhar para trás no que o gravador gravou.

Onda 2 do A19. Tudo aqui **dorme**: nada no agente chama estes módulos ainda.

- `bloco`   — ler um trecho baixado e escolher o quadro parado dele;
- `perfil`  — medir o que ESTE gravador entrega pelo caminho de arquivo (o
  tamanho do bloco, onde os blocos começam, quantos quadros por segundo e em
  quanto tempo a gravação fica disponível) e guardar na máquina;
- `busca`   — a busca pelo meio: entre duas olhadas, achar onde a cena mudou
  lendo um bloco por passo (a conta, sem gravador);
- `grade`   — a grade de quadros numerados de uma janela (a conta, sem
  gravador);
- `gravado` — a busca e a grade com o gravador da loja: a hora dele, só o
  que já assentou, e o trecho conferido pelos quadros;
- `guarda`  — a sequência guardada ao lado das análises, com teto e rodízio.

O pedido ao gravador é do `dvr.arquivo`.
"""
