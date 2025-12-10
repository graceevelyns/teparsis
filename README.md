# Tugas Besar Sistem Paralel dan Terdistribusi 2025

# [Nama Kelompok] - [Kelas]

## Anggota Kelompok

| Nama           | NIM        |
|----------------|------------|
|    Anggota 1            |   NIM 1         |
|    Anggota 2            |   NIM 2         |
|    Anggota 3            |   NIM 3         |

## Status Fitur
<p>Note: status bisa (selesai, setengah jadi, blm selesai)</p><br/>

| Fitur               | Status       |
|---------------------|--------------|
| Heartbeat          | blm selesai  |
| Leader Election    | blm selesai  |
| Log Replication    | blm selesai  |
| Membership Change  | blm selesai  |
| Unit Testing (bonus)| blm selesai  |
| Transaction (bonus) | blm selesai  |
| Log Compaciton (bonus)| blm selesai  |

### tutorial lari

```bash
git clone https://github.com/labsister22/tugas-besar-if3130-sistem-paralel-dan-terdistribusi-teparsis.git
cd tugas-besar-if3130-sistem-paralel-dan-terdistribusi-teparsis

# Start semua services (3 Raft nodes + web client)
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
├── docker-compose.yml          # Docker orchestration
├── DOCKER.md                   # Docker documentation
├── src/
│   ├── server/                # Raft server implementation
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── core/         # Raft consensus logic
│   │   │   ├── store/        # KV store
│   │   │   ├── network/      # Peer communication
│   │   │   └── api/          # REST API
│   │   └── README.md
│   └── client/                # Web client
│       ├── Dockerfile
│       ├── src/
│       │   ├── client.ts     # API client
│       │   ├── app.ts        # UI logic
│       │   └── styles.css    # Styling
│       ├── index.html
│       └── README.md
└── README.md
```

