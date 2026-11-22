// Software-only OTA peer for the pinned fm1-emu CPU and USB models.
use fm1_core::{Bus, Cpu};
use fm1_soc::{machine, stock_boot, stock_from_package, FlashPart, Soc, RAM_BASE};
use std::{
    env, fs,
    time::{Duration, Instant},
};

const RAM_SIZE: usize = 1 << 20;
const QUERY: &[u8] = &[0xf0, 0, 0x32, 0x45, 0, 0, 0, 0x40, 0x7f, 0xf7];
const QUERY_FULL: &[u8] = &[0xf0, 0, 0x32, 0x45, 8, 0, 0, 0x40, 0, 0x7e, 1, 0xf7];
const UPGRADE: &[u8] = &[0xf0, 0x22, 0x24, 0x35, 0x7f, 0xf7];

fn unpack(packet: &[u8]) -> Vec<u8> {
    let (mut value, mut bits) = (0u16, 0);
    let mut out = Vec::new();
    for &byte in packet {
        value |= u16::from(byte & 0x7f) << bits;
        bits += 7;
        if bits >= 8 {
            out.push(value as u8);
            value >>= 8;
            bits -= 8;
        }
    }
    out
}

fn pack(data: &[u8]) -> Vec<u8> {
    let (mut value, mut bits) = (0u16, 0);
    let mut out = vec![0xf0];
    for &byte in data {
        value |= u16::from(byte) << bits;
        bits += 8;
        while bits >= 7 {
            out.push((value & 0x7f) as u8);
            value >>= 7;
            bits -= 7;
        }
    }
    if bits > 0 {
        out.push(value as u8);
    }
    out.push(0xf7);
    out
}

fn reply(request: &[u8], image: &[u8]) -> Result<(u32, Vec<u8>), String> {
    let address = u32::from_le_bytes(request[7..11].try_into().unwrap());
    let length = u32::from_le_bytes([request[11], request[12], request[13], 0]) as usize;
    let payload: &[u8] = match address {
        0xe0000000 | 0xf0000000 if length == 8 => b"success\0",
        _ if length != 0 && length <= 4096 => {
            let from = address as usize;
            image
                .get(from..from + length)
                .ok_or("out-of-range OTA request")?
        }
        _ => return Err(format!("invalid OTA request: {address:08x}+{length}")),
    };
    let mut response = vec![0, 0x59, 0x30];
    response.extend_from_slice(&((payload.len() as u32 + 8).to_le_bytes()[..3]));
    response.extend_from_slice(&request[6..14]);
    response.extend_from_slice(payload);
    response.push(
        !response[6..]
            .iter()
            .fold(0u8, |sum, byte| sum.wrapping_add(*byte)),
    );
    Ok((address, pack(&response)))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    let [path, chip, mode, snapshot, residue @ ..] = args.as_slice() else {
        return Err("Usage: ota-emulator PACKAGE CHIP seed|stage|probe FLASH-FILE or PACKAGE CHIP loader FLASH-OUTPUT FLASH-INPUT LOADER-BIN".into());
    };
    if !matches!(mode.as_str(), "seed" | "stage" | "probe" | "loader") {
        return Err("Unknown mode".into());
    }
    let loader_input = match (mode.as_str(), residue) {
        ("loader", [flash, executable]) => Some((flash, executable)),
        ("loader", _) => return Err("loader requires FLASH-INPUT and LOADER-BIN".into()),
        (_, []) => None,
        _ => return Err("Unexpected parameters".into()),
    };
    let package = fs::read(path)?;
    if package.len() < 960 {
        return Err("Truncated firmware package".into());
    }
    let mut image = Vec::with_capacity(package.len());
    for block in package[..960].chunks_exact(48) {
        image.extend_from_slice(&block[..47]);
    }
    image.extend_from_slice(&package[960..]);
    let stock = stock_from_package(&package, None)?;
    if mode == "seed" {
        fs::write(snapshot, &stock.flash)?;
        return Ok(());
    }
    let expected_identity = stock.identity.clone();
    let mut soc = Soc::new(RAM_SIZE, stock.xip);
    soc.set_flash_part(FlashPart::parse(chip).ok_or("invalid Flash model")?);
    let strict = mode == "probe";
    let loader = mode == "loader";
    let ticks = if strict { 8 } else { 1 };
    soc.periph.cycle_ticks = ticks;
    soc.periph.hz = 240_000_000 * ticks;
    soc.strict_align = strict;
    soc.lcd_timed = strict;
    if strict {
        soc.loop_skip.enabled = false;
        soc.xip_cache = Some(fm1_soc::XipCache::default());
    }
    soc.periph.skip_idle = true;
    let mut cpu = Cpu::new(stock.entry);
    cpu.user = true;
    cpu.jit_on = !strict;
    cpu.cost_model = strict;
    let params = RAM_BASE + 0x7fc00;
    soc.write32(params, params + 0x40);
    cpu.regs[0] = stock_boot(&mut soc, &stock.flash, params, stock.board);
    soc.sfc_boot(stock.key, stock.app_end);
    if mode == "probe" {
        let contents = fs::read(snapshot)?;
        if contents.len() != stock.flash.len() {
            return Err("Snapshot is not a full Flash dump".into());
        }
        soc.restore_flash(&contents);
    }
    if let Some((flash, executable)) = loader_input {
        let staged = fs::read(flash)?;
        if staged.len() != stock.flash.len() {
            return Err("Loader input is not a full Flash dump".into());
        }
        soc.restore_flash(&staged);
        let executable = fs::read(executable)?;
        if executable.len() > 0x14000 || executable.get(2..18) != Some(b"FELUCCA-LOADER-1") {
            return Err("Unexpected RAM loader executable".into());
        }
        for (index, byte) in executable.into_iter().enumerate() {
            soc.write8(0x01c0a800 + index as u32, byte);
        }
        cpu.pc = 0x01c0a800;
    }
    soc.usb_plug();
    let mut cpu1 = None;
    let mut tick = false;
    let mut queried = false;
    let mut full_query = false;
    let mut identified = false;
    let mut requests = 0;
    let mut finish = None;
    let mut after_reset = false;
    let deadline = Instant::now() + Duration::from_secs(90);
    while soc.periph.ms() < if loader { 180_000 } else { 15_000 } && Instant::now() < deadline {
        machine::run_dual(
            &mut cpu1,
            &mut soc,
            20_000,
            RAM_SIZE,
            !strict,
            |soc, count| machine::run_blocks(&mut cpu, soc, count, &mut tick),
        )?;
        let now = soc.periph.ms();
        if strict && (soc.dbg_cause != 0 || soc.emu_cause != 0) {
            return Err(format!(
                "CPU guard tripped: DBG={:x}, EMU={:x}",
                soc.dbg_cause, soc.emu_cause
            )
            .into());
        }
        if finish.is_some_and(|time| now > time + 200) && !after_reset {
            soc.usb.midi_send(QUERY);
            after_reset = true;
        }
        if now >= 1_500 && !queried {
            soc.usb.midi_send(QUERY);
            queried = true;
        }
        for midi in soc.usb.midi_take() {
            if midi.first() != Some(&0xf0) || midi.last() != Some(&0xf7) {
                continue;
            }
            let frame = unpack(&midi[1..midi.len() - 1]);
            if frame.starts_with(&[0, 0x59, 0x11]) && frame.len() == 34 {
                let text = frame[6..30].split(|byte| *byte == 0).next().unwrap();
                let text = std::str::from_utf8(text)?;
                if identified {
                    if after_reset {
                        println!("post-stage identity={text}");
                    }
                    continue;
                }
                if (!loader && (!expected_identity.starts_with(text) || !text.starts_with("FM-1_")))
                    || (loader && !text.starts_with("ota-FM-1_"))
                {
                    return Err(format!("Unexpected firmware identity: {text}").into());
                }
                if mode == "probe" && text != expected_identity {
                    if full_query {
                        return Err(format!("Expected full firmware identity, got {text}").into());
                    }
                    soc.usb.midi_send(QUERY_FULL);
                    full_query = true;
                    continue;
                }
                identified = true;
                if mode == "probe" {
                    let before = fs::read(snapshot)?;
                    let after = &soc.flash.mem;
                    // Boot may clean the five stale staging sectors. It must not program
                    // them or change any other byte in Flash.
                    if soc.flash.ops > 5
                        || before[..0xe0000] != after[..0xe0000]
                        || before[0xe5000..] != after[0xe5000..]
                        || before[0xe0000..0xe5000]
                            .iter()
                            .zip(&after[0xe0000..0xe5000])
                            .any(|(old, new)| old | new != *new)
                    {
                        return Err("Unexpected write during restart verification".into());
                    }
                    println!("strict CPU/USB identity={text}; observed guards clear; staging cleanup ops={}", soc.flash.ops);
                    return Ok(());
                }
                soc.usb.midi_send(UPGRADE);
            }
            if frame.len() == 15
                && frame.starts_with(&[0, 0x59, 0x30])
                && frame[6..]
                    .iter()
                    .fold(0u8, |sum, byte| sum.wrapping_add(*byte))
                    == 0xff
            {
                let (address, message) = reply(&frame, &image)?;
                requests += 1;
                soc.usb.midi_send(&message);
                if address == if loader { 0xf0000000 } else { 0xe0000000 } {
                    finish = Some(now);
                }
            }
        }
        if soc.flash.cut() || finish.is_some_and(|time| now > time + 1_500) {
            break;
        }
    }
    fs::write(snapshot, &soc.flash.mem)?;
    println!(
        "identity={identified} requests={requests} staged={} ops={} cut={} resets={}",
        finish.is_some(),
        soc.flash.ops,
        soc.flash.cut(),
        soc.resets
    );
    let requested_cut = soc.flash.cut_at;
    if !identified
        || requests == 0
        || soc.flash.ops == 0
        || requested_cut.is_some_and(|cut| !soc.flash.cut() || soc.flash.ops < cut)
        || (requested_cut.is_none() && finish.is_none())
    {
        return Err("OTA staging or injected power cut was not reached".into());
    }
    if loader {
        if soc.flash.cut() && soc.flash.mem[0x4000..0x5000] == stock.flash[0x4000..0x5000] {
            return Err("Cut left the first application sector intact".into());
        }
        if !soc.flash.cut() && soc.flash.mem[0x4000..0x93000] != stock.flash[0x4000..0x93000] {
            return Err("Application Flash does not match package after real loader".into());
        }
        if soc.flash.mem[..0x4000] != stock.flash[..0x4000]
            || soc.flash.mem[0x93000..0xe0000] != stock.flash[0x93000..0xe0000]
            || soc.flash.mem[0xe5000..] != stock.flash[0xe5000..]
        {
            return Err("Loader modified a protected range".into());
        }
        return Ok(());
    }
    if soc.flash.mem[..0xe0000] != stock.flash[..0xe0000]
        || soc.flash.mem[0xe5000..] != stock.flash[0xe5000..]
    {
        return Err("OTA staging modified Flash outside 0xe0000..0xe5000".into());
    }
    Ok(())
}
