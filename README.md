# 局域网工程监控测试终端

这个版本用于在没有云服务器之前，用同一局域网内的电脑做测试。

## 运行电脑代理

在被测试的电脑上双击：

```text
start-lan-agent.bat
```

这个脚本使用 Windows 自带 PowerShell，不需要安装 Node.js。

代理默认监听：

```text
http://电脑局域网IP:8787
```

测试数据目录会自动生成在：

```text
lan-agent-data/
```

你可以把日志放到 `lan-agent-data/logs/`，把视频放到 `lan-agent-data/videos/`。

## 前端连接

打开 `index.html`，把“电脑代理地址”改成被测试电脑的局域网地址，例如：

```text
http://192.168.1.100:8787
```

然后点击“连接电脑”。
