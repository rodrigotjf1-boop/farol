import { NextResponse, type NextRequest } from 'next/server';

/**
 * Manda para o login quem não tem cookie de sessão.
 *
 * ⚠️ Isto é CONVENIÊNCIA, não segurança. O middleware só vê que existe um
 * cookie — não sabe se ele vale, se expirou ou se foi revogado, porque
 * não fala com o banco. Quem decide é a API, em toda requisição.
 *
 * Confiar nisto para proteger dado seria repetir o erro que o projeto
 * proíbe desde o primeiro dia: RBAC no servidor, nunca no front.
 */
export function middleware(req: NextRequest) {
  const tem = req.cookies.has('farol_sessao');
  const indo = req.nextUrl.pathname;

  if (!tem && indo !== '/entrar') {
    const destino = new URL('/entrar', req.url);
    return NextResponse.redirect(destino);
  }
  if (tem && indo === '/entrar') {
    return NextResponse.redirect(new URL('/painel', req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Fora: as rotas da API (o proxy), os arquivos do Next e os arquivos de
  // `public/` — ícone e logotipo têm que chegar também a quem ainda não
  // entrou, senão a própria tela de entrada fica sem marca.
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|favicon\\.svg|icone-\\d+\\.png).*)'],
};
