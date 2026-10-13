# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the login of the SLZB web interface (username and password), if
  you set one, is a field of the Gladys configuration (the password a `secret`
  field). The integration reads it from Gladys, keeps it in memory, sends it
  only to the coordinators (HTTP Basic authentication, over the local network,
  in plain HTTP: the SLZB web interface has no HTTPS), and never writes it to
  `/data` nor to the logs.
- **Stored in `/data`**: `smlight-state.json`, the firmware versions already
  announced to the scenes and the last IP address of each coordinator (by MAC
  address). Nothing else.
- **Network**: requests go to the coordinators (the addresses typed in the
  configuration or found by the mDNS discovery of Gladys), on the local
  network: HTTP on the port of their web interface, and their event stream on
  port 81. With the firmware check on (default), one HTTPS request per firmware
  and per day goes to the SMLIGHT update server (`updates.smlight.tech`), with
  the model of the coordinator, never its address nor its login. The
  integration opens no port and installs nothing on the coordinators.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the SLZB coordinators and their firmware (report to SMLIGHT), and the other
devices and services of your network.
