# Privacy Sentinel

Extensao para Firefox que monitora rastreadores, cookies e tecnicas de fingerprinting para avaliar o nivel de privacidade de uma pagina web.

## Recursos principais
- Detecta conexoes de terceiros e sinaliza dominios presentes nas listas de rastreadores.
- Bloqueia automaticamente rastreadores conhecidos (pode ser desativado nas configuracoes).
- Resume cookies de primeira e terceira parte, identifica cookies persistentes e possiveis sincronismos.
- Captura o uso de APIs de Canvas associadas a fingerprinting.
- Monitora armazenamento HTML5 (localStorage, sessionStorage, IndexedDB) e gera indicativos de supercookies.
- Atribui uma pontuacao de risco (0 a 100) com classificacao de Baixo risco, Atencao ou Alto risco.

## Como instalar temporariamente (Firefox)
1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em **Load Temporary Add-on...** e selecione `manifest.json` na pasta `c:\\Users\\lucaf\\extension`.
3. O icone da extensao sera exibido na barra; abra o popup para ver o painel e acompanhe os alertas durante a navegacao.

## Fluxo com web-ext (opcional)
1. Instale as dependencias: `npm install -g web-ext`.
2. Inicie a extensao com recarregamento automatico: `web-ext run --source-dir c:\\Users\\lucaf\\extension`.

## Configuracoes
- Abra o popup enquanto estiver em uma aba http ou https; paginas internas do Firefox (about:, moz-extension:) nao expõem dados de rastreadores.
- Use o botao **Configuracoes** no topo do popup para habilitar/desabilitar bloqueio automatico, notificacoes e editar listas personalizadas sem sair do painel.
- Cada dominio deve ser informado em uma linha (por exemplo `example-tracker.com`).
- As configuracoes sao salvas em `browser.storage.local` e aplicadas imediatamente.

## Dicas de teste
- Utilize sites conhecidos por usar rastreadores (ex.: portais de noticias) para observar bloqueios e conexoes de terceiros.
- Gere eventos de Canvas fingerprint acessando paginas de demonstracao como `https://fingerprintable.org`.
- Limpe cookies e storage entre testes para comparar pontuacoes.

## Estrutura do projeto
```
manifest.json
background/
  background.js
content/
  content-monitor.js
popup/
  popup.html
  popup.js
  popup.css
options/
  options.html
  options.js
  options.css
data/
  tracker-list.json
icons/
  icon-48.png
  icon-96.png
```



