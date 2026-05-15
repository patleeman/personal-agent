use std::env;
use std::time::Duration;

use anyhow::{anyhow, Context};
use base64::Engine;
use iroh::endpoint::{presets, IdleTimeout, QuicTransportConfig};
use iroh::{Endpoint, SecretKey};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tracing::{info, warn};

const PROTOCOL_VERSION: u32 = 1;
const ALLEYCAT_ALPN: &[u8] = b"alleycat/1";
const AGENT_NAME: &str = "personal-agent";
const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone)]
struct Config {
    token: String,
    secret_key: SecretKey,
    jsonl_host: String,
    jsonl_port: u16,
}

#[derive(Debug, Serialize)]
struct PairPayload {
    v: u32,
    node_id: String,
    token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    relay: Option<String>,
}

#[derive(Debug, Serialize)]
struct AgentInfo {
    name: &'static str,
    display_name: &'static str,
    wire: &'static str,
    available: bool,
    presentation: AgentPresentation,
    capabilities: AgentCapabilities,
}

#[derive(Debug, Serialize)]
struct AgentPresentation {
    title: &'static str,
    is_beta: bool,
    sort_order: i32,
    description: &'static str,
    aliases: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
struct AgentCapabilities {
    locks_reasoning_effort_after_activity: bool,
    supports_ssh_bridge: bool,
    uses_direct_codex_port: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    ListAgents {
        v: u32,
        token: String,
    },
    RestartAgent {
        v: u32,
        token: String,
        agent: String,
    },
    Connect {
        v: u32,
        token: String,
        agent: String,
        resume: Option<Resume>,
    },
}

#[derive(Debug, Deserialize)]
struct Resume {
    #[allow(dead_code)]
    last_seq: u64,
}

#[derive(Debug, Serialize)]
struct Response {
    v: u32,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    agents: Option<Vec<AgentInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session: Option<SessionInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct SessionInfo {
    attached: &'static str,
    current_seq: u64,
    floor_seq: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let config = load_config()?;
    let endpoint = bind_endpoint(config.secret_key.clone()).await?;
    let pair = PairPayload {
        v: PROTOCOL_VERSION,
        node_id: config.secret_key.public().to_string(),
        token: config.token.clone(),
        host_name: hostname::get()
            .ok()
            .and_then(|name| name.into_string().ok()),
        relay: endpoint
            .addr()
            .relay_urls()
            .next()
            .map(|url| url.to_string()),
    };
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({ "type": "ready", "pairPayload": pair }))?
    );

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("shutdown requested");
                endpoint.close().await;
                return Ok(());
            }
            incoming = endpoint.accept() => {
                let Some(connecting) = incoming else { return Ok(()); };
                let config = config.clone();
                tokio::spawn(async move {
                    match connecting.await {
                        Ok(conn) => {
                            let remote = conn.remote_id().to_string();
                            info!(%remote, "iroh connection accepted");
                            while let Ok((send, recv)) = conn.accept_bi().await {
                                let config = config.clone();
                                tokio::spawn(async move {
                                    if let Err(error) = handle_stream(send, recv, config).await {
                                        warn!("alleycat stream ended: {error:#}");
                                    }
                                });
                            }
                        }
                        Err(error) => warn!("incoming connection failed: {error:#}"),
                    }
                });
            }
        }
    }
}

fn load_config() -> anyhow::Result<Config> {
    let token = env::var("PA_ALLEYCAT_TOKEN").context("PA_ALLEYCAT_TOKEN is required")?;
    let secret =
        env::var("PA_ALLEYCAT_SECRET_KEY").context("PA_ALLEYCAT_SECRET_KEY is required")?;
    let secret_bytes = base64::engine::general_purpose::STANDARD
        .decode(secret.as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(secret.as_bytes()))
        .context("decoding PA_ALLEYCAT_SECRET_KEY")?;
    let secret_key = SecretKey::try_from(secret_bytes.as_slice())
        .map_err(|_| anyhow!("invalid PA_ALLEYCAT_SECRET_KEY"))?;
    let jsonl_host = env::var("PA_ALLEYCAT_JSONL_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let jsonl_port = env::var("PA_ALLEYCAT_JSONL_PORT")
        .context("PA_ALLEYCAT_JSONL_PORT is required")?
        .parse::<u16>()
        .context("PA_ALLEYCAT_JSONL_PORT must be a TCP port")?;
    Ok(Config {
        token,
        secret_key,
        jsonl_host,
        jsonl_port,
    })
}

async fn bind_endpoint(secret_key: SecretKey) -> anyhow::Result<Endpoint> {
    let idle_timeout = IdleTimeout::try_from(Duration::from_secs(600))
        .context("constructing iroh idle timeout")?;
    let transport = QuicTransportConfig::builder()
        .max_idle_timeout(Some(idle_timeout))
        .build();
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(secret_key)
        .alpns(vec![ALLEYCAT_ALPN.to_vec()])
        .transport_config(transport)
        .bind()
        .await
        .context("binding iroh endpoint")?;
    info!(node_id = %endpoint.id(), "PA Alleycat endpoint bound");
    Ok(endpoint)
}

async fn handle_stream(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    config: Config,
) -> anyhow::Result<()> {
    let request: Request = read_json_frame(&mut recv).await?;
    validate_request(&request, &config.token)?;

    match request {
        Request::ListAgents { .. } => {
            write_json_frame(&mut send, &Response::agents(vec![personal_agent(true)])).await?;
            Ok(())
        }
        Request::RestartAgent { agent, .. } => {
            if agent != AGENT_NAME {
                write_json_frame(
                    &mut send,
                    &Response::error(format!("agent `{agent}` is disabled or unknown")),
                )
                .await?;
                return Err(anyhow!("unknown agent: {agent}"));
            }
            write_json_frame(&mut send, &Response::ok()).await?;
            Ok(())
        }
        Request::Connect { agent, resume, .. } => {
            if agent != AGENT_NAME {
                write_json_frame(
                    &mut send,
                    &Response::error(format!("agent `{agent}` is disabled or unknown")),
                )
                .await?;
                return Err(anyhow!("unknown agent: {agent}"));
            }
            write_json_frame(&mut send, &Response::ok_with_session(resume)).await?;
            let tcp = TcpStream::connect((config.jsonl_host.as_str(), config.jsonl_port))
                .await
                .with_context(|| {
                    format!(
                        "connecting to PA JSONL bridge on {}:{}",
                        config.jsonl_host, config.jsonl_port
                    )
                })?;
            let iroh_stream = IrohBiStream { recv, send };
            bridge_jsonl(tcp, iroh_stream).await
        }
    }
}

async fn bridge_jsonl(mut tcp: TcpStream, iroh_stream: IrohBiStream) -> anyhow::Result<()> {
    let (mut tcp_read, mut tcp_write) = tcp.split();
    let (mut iroh_read, mut iroh_write) = iroh_stream.split();
    tokio::select! {
        result = tokio::io::copy(&mut iroh_read, &mut tcp_write) => { result.context("copying client to PA JSONL bridge")?; }
        result = tokio::io::copy(&mut tcp_read, &mut iroh_write) => { result.context("copying PA JSONL bridge to client")?; }
    }
    Ok(())
}

fn validate_request(request: &Request, expected_token: &str) -> anyhow::Result<()> {
    let (version, token) = match request {
        Request::ListAgents { v, token }
        | Request::RestartAgent { v, token, .. }
        | Request::Connect { v, token, .. } => (*v, token),
    };
    if version != PROTOCOL_VERSION {
        return Err(anyhow!(
            "protocol mismatch: client={version} host={PROTOCOL_VERSION}"
        ));
    }
    if token != expected_token {
        return Err(anyhow!("invalid token"));
    }
    Ok(())
}

fn personal_agent(available: bool) -> AgentInfo {
    AgentInfo {
        name: AGENT_NAME,
        display_name: "Personal Agent",
        wire: "jsonl",
        available,
        presentation: AgentPresentation {
            title: "Personal Agent",
            is_beta: true,
            sort_order: 0,
            description: "Personal Agent conversations exposed to Kitty Litter.",
            aliases: vec!["pa", "personalagent"],
        },
        capabilities: AgentCapabilities {
            locks_reasoning_effort_after_activity: false,
            supports_ssh_bridge: false,
            uses_direct_codex_port: false,
        },
    }
}

async fn read_json_frame<T, R>(reader: &mut R) -> anyhow::Result<T>
where
    T: for<'de> Deserialize<'de>,
    R: AsyncRead + Unpin,
{
    let len = reader.read_u32().await.context("reading frame length")? as usize;
    if len > MAX_FRAME_BYTES {
        return Err(anyhow!("frame too large: {len} bytes"));
    }
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .await
        .context("reading frame body")?;
    serde_json::from_slice(&buf).context("decoding JSON frame")
}

async fn write_json_frame<T, W>(writer: &mut W, value: &T) -> anyhow::Result<()>
where
    T: Serialize,
    W: AsyncWrite + Unpin,
{
    let buf = serde_json::to_vec(value).context("encoding JSON frame")?;
    if buf.len() > MAX_FRAME_BYTES {
        return Err(anyhow!("frame too large: {} bytes", buf.len()));
    }
    writer
        .write_u32(buf.len() as u32)
        .await
        .context("writing frame length")?;
    writer.write_all(&buf).await.context("writing frame body")?;
    writer.flush().await.context("flushing frame")?;
    Ok(())
}

impl Response {
    fn ok() -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: true,
            agents: None,
            session: None,
            error: None,
        }
    }

    fn ok_with_session(resume: Option<Resume>) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: true,
            agents: None,
            session: Some(SessionInfo {
                attached: if resume.is_some() { "resumed" } else { "fresh" },
                current_seq: 0,
                floor_seq: 0,
            }),
            error: None,
        }
    }

    fn agents(agents: Vec<AgentInfo>) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: true,
            agents: Some(agents),
            session: None,
            error: None,
        }
    }

    fn error(error: impl Into<String>) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: false,
            agents: None,
            session: None,
            error: Some(error.into()),
        }
    }
}

struct IrohBiStream {
    recv: iroh::endpoint::RecvStream,
    send: iroh::endpoint::SendStream,
}

impl IrohBiStream {
    fn split(
        self,
    ) -> (
        BufReader<iroh::endpoint::RecvStream>,
        iroh::endpoint::SendStream,
    ) {
        (BufReader::new(self.recv), self.send)
    }
}
