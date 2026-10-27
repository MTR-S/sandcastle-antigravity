# Sandcastle Antigravity

Orquestrador autônomo de múltiplos agentes de código em sandboxes Docker isolados para o Google Antigravity CLI (`agy`), construído como extensão comunitária sobre a biblioteca `@ai-hero/sandcastle` de Matt Pocock. Permite executar ciclos de planejamento, implementação, revisão e merge contra qualquer Repositório Alvo local.

## Language

### Orquestração e Isolamento

**Target Repository**:
Repositório Git local de qualquer projeto de software onde o orquestrador é invocado para resolver issues e integrar código. Permanece livre do código-fonte do orquestrador.
_Avoid_: projeto pai, workspace do orquestrador, repositório host

**Phase Pipeline**:
Ciclo autônomo dividido em quatro papéis sequenciais de agente: *Planner* (análise de grafo de dependências de issues), *Implementer* (codificação orientada a testes em branch isolada), *Reviewer* (auditoria de diff e aderência a padrões) e *Merger* (integração na branch base e fechamento de issues).
_Avoid_: loop de agente único, execução monolítica

**Base Branch**:
Branch de integração do Target Repository a partir da qual as branches de trabalho dos agentes são derivadas e na qual o *Merger* consolida os commits aprovados.
_Avoid_: main branch (quando a branch principal é protegida), master

**Protected Branches**:
Conjunto de branches do Target Repository que nunca podem ser modificadas, receber commits diretos ou sofrer merge pelos agentes autônomos.
_Avoid_: branches ignoradas

**Verification Command**:
Comando determinístico de compilação e execução da suíte de testes próprio do Target Repository que valida se uma alteração mantém o sistema íntegro antes de commits ou merges.
_Avoid_: linter isolado, build sem teste

### Autenticação e Configuração

**Host OAuth Session Bridge**:
Ponte de autenticação que extrai em memória a sessão OAuth ativa do Google Antigravity CLI na máquina hospedeira (`gemini:antigravity`) e a projeta no serviço de keyring D-Bus dentro do container isolado, eliminando chaves de API estáticas.
_Avoid_: API key forwarding, login interativo no container, token em arquivo

**Pre-Run Configuration Banner**:
Etapa interativa pré-execução que exibe na CLI todas as opções padrões autodetectadas (Target Repository, conta GitHub, identidade Git, Base Branch, Protected Branches, Verification Command e modelos de cada fase) permitindo confirmação imediata ou edição pontual pelo operador antes de criar worktrees ou containers.
_Avoid_: execução às cegas, configuração oculta
