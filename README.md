# ZapBot IA

Aplicativo desktop em Electron para atendimento no WhatsApp com IA local via Ollama.

## Pacotes

- `npm run build`: gera o instalador inicial completo em `dist_base/`, incluindo runtime e modelo do Ollama. Esse comando exige que os insumos locais estejam em `vendor/ollama/`.
- `npm run build:update`: gera o pacote semanal leve em `dist_update/`, sem Ollama.

Dados locais, sessao do WhatsApp, modelos, runtime do Ollama e instaladores nao sao versionados.

## Atualizacao semanal

O workflow `.github/workflows/weekly-auto-release.yml` roda toda segunda-feira e tambem pode ser iniciado manualmente. Ele:

1. atualiza `whatsapp-web.js`;
2. atualiza o Electron, que inclui o Chromium;
3. incrementa a versao do app;
4. gera e publica um instalador leve no GitHub Releases;
5. atualiza `update-manifest.json`.

Antes de instalar o primeiro update leve, o aplicativo move o runtime e prepara o modelo do Ollama na pasta persistente do usuario. Assim, updates futuros nao baixam nem substituem o Ollama.

## Limite do GitHub

O instalador inicial completo ultrapassa 2 GiB e deve ser distribuido fora do GitHub Releases. O GitHub armazena apenas o codigo e os updates semanais leves.
