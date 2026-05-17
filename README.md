# @nexus-legal/mcp

Servidor MCP (Model Context Protocol) de **Nexus Legal** — expone 11 capabilities jurídicas especializadas a Claude Desktop, Claude Code, Cursor y cualquier otro cliente compatible con MCP.

> **¿Qué es esto?** Conectas tu Claude con Nexus en 30 segundos, y a partir de ese momento Claude puede invocar análisis jurídico ISO 31000 sobre **31 jurisdicciones**, simulación Monte Carlo de litigación, búsqueda de jurisprudencia, redacción de escritos, doctrina administrativa, red team adversarial y comparativas multi-jurisdiccionales (Cross-Border) sin salir de la conversación.

---

## Instalación rápida

### 1. Genera una clave MCP

Entra a [nexusquantum.legal/developers](https://nexusquantum.legal/developers), elige **"Servidor MCP"**, dale un nombre (ej. "MacBook personal") y pulsa **+ Crear clave MCP**. Copia la clave `nlk_...` — solo se enseña una vez.

### 2. Configura tu cliente

#### Claude Desktop (macOS)

Edita `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nexus-legal": {
      "command": "npx",
      "args": ["-y", "@nexus-legal/mcp"],
      "env": {
        "NEXUS_API_KEY": "nlk_TU_CLAVE_AQUI"
      }
    }
  }
}
```

Reinicia Claude Desktop. Verás un icono 🔌 en el chat con las 11 tools de Nexus disponibles.

#### Claude Desktop (Windows)

Edita `%APPDATA%\Claude\claude_desktop_config.json` con el mismo contenido.

#### Claude Code (CLI)

```bash
claude mcp add nexus-legal -- npx -y @nexus-legal/mcp
# Después establece tu key:
export NEXUS_API_KEY=nlk_TU_CLAVE_AQUI
```

#### Cursor

Edita `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nexus-legal": {
      "command": "npx",
      "args": ["-y", "@nexus-legal/mcp"],
      "env": { "NEXUS_API_KEY": "nlk_TU_CLAVE_AQUI" }
    }
  }
}
```

### 3. Pruébalo

En Claude Desktop, escribe:

> Analiza este contrato con Nexus en jurisdicción ES, rama mercantil, perfil conservador: «[pega aquí el texto del contrato]»

Claude llamará automáticamente a la tool `nexus_analyze` y te devolverá el informe con candados de certeza `[L1]`/`[L2-J]`/`[L3-NV]`/`[L4]` + señales bloqueantes `[L5-C]`/`[L5-P]` + bloque `NEXUS-AUDIT-TRAIL`.

---

## Las 11 tools

| Tool | Capability | Coste típico |
|---|---|---|
| `nexus_analyze` | Análisis jurídico íntegro (Nodo A — ISO 31000) | 1-3 créditos |
| `nexus_consulta` | Consulta jurídica libre con o sin documento | 1 crédito |
| `nexus_draft` | Redacción de escrito jurídico (recurso, demanda, etc.) | 2-4 créditos |
| `nexus_audit` | Auditoría cruzada de un análisis Nodo A (Nodo B) | 1-2 créditos |
| `nexus_monte_carlo` | Simulación Monte Carlo de escenarios (ISO 31000 §6) | 4 créditos |
| `nexus_doctrina` | Búsqueda de doctrina administrativa según jurisdicción | 1 crédito |
| `nexus_opinion` | Segunda opinión multi-LLM sobre análisis previo | 2 créditos |
| `nexus_redteam` | Red team adversarial (vulnerabilidades JSON estructurado) | 5 créditos |
| `nexus_adversarial` | Argumentación adversarial en prosa sobre análisis previo | 2-3 créditos |
| `nexus_cross_border_compare` | Comparativa multi-jurisdiccional (2-15 países) | 2-4 créditos |
| `nexus_jurisprudencia_search` | Búsqueda semántica en corpus jurisprudencial multi-jurisdicción | gratis |

Las 30+ jurisdicciones soportadas (`ES`, `CO`, `MX`, `AR`, `CL`, `PE`, `UY`, `EC`, `BO`, `PY`, `VE`, `PA`, `GB`, `FR`, `DE`, `IT`, `PT`, `NL`, `CH`, `IE`, `AE`, `CA`, `AU`, `SG`, `JP`, `IN`, `HK`, `ZA`, `SA`, `BR`, `US` con state overlays `US-CA`/`US-NY`/`US-DE`/`US-TX`, y `MULTI` para análisis cross-border).

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `NEXUS_API_KEY` | — | **Obligatoria.** Clave `nlk_...` con scope `mcp`. |
| `NEXUS_BASE_URL` | `https://nexusquantum.legal` | Para entornos de prueba o self-hosted. |
| `NEXUS_TIMEOUT_MS` | `180000` (3 min) | Timeout para análisis largos. |

---

## Privacidad y RGPD

- **Zero Retention en plataforma EU.** Los documentos que envíes vía MCP procesan en RAM en Railway europe-west4-drams3a (Países Bajos) y NO se persisten en base de datos por defecto. La política Zero Retention de Nexus aplica al 100% del tráfico MCP igual que al tráfico web.
- **PII Gatekeeper.** Antes de llegar al LLM, el backend anonimiza DNIs, IBANs, teléfonos, emails y cuentas con tokens reversibles (`[DNI_1]`, `[ACCOUNT_3]`...). El cliente MCP solo ve el output ya re-identificado por nuestro pipeline.
- **Auditoría.** Cada tool call queda registrada en `analysis_costs` y `api_usage_stats` (con `via_api_key_id`) para facturación y trazabilidad.

---

## Soporte

- Email: support@nexusquantum.legal
- Documentación: https://nexusquantum.legal/developers
- Issues: https://github.com/djtellado/nexus-legal-prod/issues

---

## Licencia

MIT
