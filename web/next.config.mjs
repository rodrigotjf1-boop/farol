/**
 * O navegador NUNCA fala com a API diretamente.
 *
 * Tudo que o console pede sai para o próprio domínio (`/api/...`) e o Next
 * repassa para a API pela rede interna do EasyPanel. Três coisas vêm de
 * graça com isso:
 *
 *   1. Sem CORS. Origem única, nenhuma negociação de cabeçalho, nenhuma
 *      chance de alguém afrouxar `Access-Control-Allow-Origin` um dia
 *      "só para testar".
 *   2. O cookie de sessão é do próprio domínio — nada de cookie entre
 *      subdomínios, que é onde SameSite começa a ter exceção.
 *   3. **A API não precisa de domínio público.** Ela fica só na rede
 *      interna, e o que não está exposto não é atacado.
 */
// A porta faz parte do padrão de propósito. A API escuta em 3000
// (`servidor.ts`, `EXPOSE 3000` no Dockerfile), e `http://farol-api`
// sozinho aponta para a 80 — porta onde ela NUNCA esteve.
//
// Um padrão que não pode funcionar é pior que padrão nenhum: em vez de
// falhar na partida, o serviço sobe e cada requisição morre com
// `ECONNREFUSED 10.0.6.4:80`, que chega ao usuário como "o servidor
// respondeu algo inesperado". Aconteceu em 06/10/2026, e o console ficou
// fora do ar sem ninguém ter mexido no console.
const API = process.env.FAROL_API_URL ?? 'http://farol-api:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Imagem enxuta: só o necessário para rodar, sem node_modules inteiro.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  async rewrites() {
    return [{ source: '/api/:caminho*', destination: `${API}/v1/:caminho*` }];
  },

  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          // O console não é para ser embutido em lugar nenhum.
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
