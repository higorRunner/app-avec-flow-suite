# Design system do FlowSuite

O produto adota superfícies azul-marinho, texto claro e acentos em azul e ciano. A pesquisa pública mantém a mesma base visual em um layout próprio para responder pelo celular.

## Fundamentos

- `public/theme.css` define tipografia, cores de texto e superfície, foco, ação primária e raios de borda. A pilha de fontes usa fontes locais e preserva um fallback legível em cada plataforma.
- `public/style.css` define o shell, grades, bordas e estados operacionais. `public/feedback.css` define o layout e os controles específicos da pesquisa, com o tema compartilhado.
- Os layouts usam `.stack` para fluxo vertical, `.grid2` para agrupamentos em duas colunas e `.form-grid` para campos. A navegação lateral abre sob demanda em telas pequenas. O atalho **Pular para o conteúdo** leva ao conteúdo principal.
- O logo em WebP é compartilhado pelo login, pela navegação, pelo ícone do navegador e pela avaliação. A cópia servida tem 512 × 171 pixels.

## Componentes compartilhados

| Componente | Uso |
| --- | --- |
| `head`, `metric`, `empty` | Cabeçalhos, indicadores e estado vazio da operação |
| `input`, `select`, `textarea` | Campo com rótulo associado, validação nativa e atributos específicos |
| `table`, `paginate` | Cabeçalhos semânticos, rolagem por teclado e páginas em clientes e relatórios |
| `confirmAction` | Confirmação de ativação, desativação, revogação de acesso e envio pela simulação |
| `toast` | Retorno de ações e falhas com região de anúncio |
| `messageBubble` | Prévia nos modelos, na revisão do relatório e no texto livre do QR Code |

Use `h` para interpolar valores em HTML e `textContent` para alterar textos existentes. Mantenha o elemento de formulário nativo e seu rótulo acessível. Inclua uma única ação primária por etapa. Para tabelas largas, preserve todas as colunas na região rolável.

## Diálogos, foco e movimento

Diálogos nativos mantêm a interação no primeiro plano. A confirmação inicia em **Cancelar**. O seletor inicia na busca, devolve o foco ao controle da configuração e sai da árvore de acessibilidade ao fechar. A área rolável do diálogo reserva espaço para o cabeçalho fixo. Os controles principais do diálogo têm altura mínima de 44 px na apresentação móvel.

As transições de diálogo usam deslocamento e opacidade. A entrada de cartões usa deslocamento para manter o contraste durante a animação. Com `prefers-reduced-motion: reduce`, as animações e transições são desativadas. Os critérios de referência estão na [WCAG 2.2 do W3C](https://www.w3.org/TR/WCAG22/).
