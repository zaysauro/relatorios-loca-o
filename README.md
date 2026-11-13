# Relatórios da Locação

Portal de relatórios da equipe de Locação (Cadena / Select), alimentado pelo Monday. **Só lê o Monday**, não grava nada nele.

## Como funciona
- `scripts/sync-monday.mjs` lê os quadros do Monday e gera um "retrato" com datas, etapas, pessoas da equipe, mídia e valores.
  - O retrato **não** leva dados de clientes: nome, telefone, e-mail, endereço, proprietário e observações ficam de fora.
- `.github/workflows/sync-monday.yml` roda a sincronização a cada 2 horas e grava o retrato no Vercel Blob.
- O site (Next.js na Vercel) lê o retrato e calcula os indicadores no navegador.

## Fontes no Monday
| Aba | Quadros |
|---|---|
| Consultores | CRM - Enison, Miqueias, Yasmin, Marcelo, Claudia (workspace CRM - CONSULTORES) |
| Pré-atendimento | CRM - PRÉ ATENDIMENTO e Histórico 2026 |
| Captação | ANGARIADORES - Follow-up, Tainara (Captação Locação) |
| Carteira | HILDA - Follow-up Proprietários da Carteira |
| Rescisões | Rescisão (workspaces Rescisão 01 e 02) |
| OKRs | Quadros OKR do workspace LUIZA (Gestão, Carteira 01/02, Rescisão 01/02, Contrato, Aux. contrato, Manutenção) |

## Segredos
- **No GitHub (Actions):** `MONDAY_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `SNAPSHOT_PATH`.
- **Na Vercel:** `BLOB_READ_WRITE_TOKEN` (pela conexão do Blob) e `SNAPSHOT_PATH`.

## Desenvolvimento
```
npm install
npm test
MONDAY_API_TOKEN=... node scripts/sync-monday.mjs --out snapshot.json
npm run build
```
