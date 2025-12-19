# Tugas Besar Sistem Paralel dan Terdistribusi 2025

# teparsis - K01 ദ്ദി ( ᵔ ᗜ ᵔ )

## Anggota Kelompok

| Nama                      | NIM      |
| ------------------------- | -------- |
| Albertus Christian Poandy | 13523077 |
| Grace Evelyn Simon        | 13523087 |
| Ahmad Ibrahim             | 13523089 |

## Penjelasan

Implementasi Distributed Key-Value Store berbasis algoritma Raft Consensus ini dirancang untuk menjamin konsistensi data dan toleransi kegagalan node dalam sistem terdistribusi. Sistem ini dibangun dengan Node.js, Express.js, dan TypeScript dan berjalan dalam 3 node cluster (port 3000-3002) yang berkomunikasi melalui HTTP/REST. Setiap node melaksanakan algoritma Raft untuk leader election, log replication, dan state machine application. Fitur utama mencakup heartbeat mechanism, leader election, log replication, dan membership change, serta bonus features seperti unit testing, transaction support, dan log compaction. Web client (port 8080) menyediakan interface untuk melakukan operasi pada key-value store.

## Status Fitur

| Fitur                  | Status  |
| ---------------------- | ------- |
| Heartbeat              | Selesai |
| Leader Election        | Selesai |
| Log Replication        | Selesai |
| Membership Change      | Selesai |
| Unit Testing (bonus)   | Selesai |
| Transaction (bonus)    | Selesai |
| Log Compaction (bonus) | Selesai |

## Cara Menjalankan

```bash
git clone https://github.com/labsister22/tugas-besar-if3130-sistem-paralel-dan-terdistribusi-teparsis.git

cd tugas-besar-if3130-sistem-paralel-dan-terdistribusi-teparsis

docker-compose up --build
```

Services akan berjalan di:

- **Web Client**: http://localhost:8080
- **Raft Node 1**: http://localhost:3000
- **Raft Node 2**: http://localhost:3001
- **Raft Node 3**: http://localhost:3002

## Struktur Project

```
.
├── README.md
├── docker-compose.yml
└── src
    ├── client
    │   ├── Dockerfile
    │   ├── README.md
    │   ├── dist
    │   │   ├── app.js
    │   │   ├── client.js
    │   │   └── styles.css
    │   ├── index.html
    │   ├── package.json
    │   ├── src
    │   │   ├── app.ts
    │   │   ├── client.ts
    │   │   └── styles.css
    │   └── tsconfig.json
    └── server
        ├── Dockerfile
        ├── README.md
        ├── node_modules
        ├── package-lock.json
        ├── package.json
        ├── src
        │   ├── api
        │   ├── config.ts
        │   ├── core
        │   ├── index.ts
        │   ├── network
        │   ├── store
        │   ├── types
        │   └── utils
        └── tsconfig.json
```

<table align="center">
    <tr>
        <td align="center" width="40%">
            <img src="image.png" alt="foto" width="280" />
        </td>
        <td align="left" width="60%">
            <strong>𝐭𝐞𝐩𝐚𝐫𝐬𝐢𝐬</strong><br/>
            ２０２５
        </td>
    </tr>
 </table>