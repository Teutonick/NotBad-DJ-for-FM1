// Compiled beside the pinned fm1-emu SPI NOR model.
#![allow(dead_code)]
mod spiflash;

use spiflash::{FlashPart, SpiFlash, FLASH_SIZE, SPI0_BASE};
use std::{env, fs, path::Path};

const PAGE: usize = 256;
const SECTOR: usize = 4096;
const APP_START: usize = 0x4000;
const APP_END: usize = 0x93000;

fn transfer(flash: &mut SpiFlash, bytes: &[u8]) {
    flash.set_cs(true);
    for &byte in bytes {
        flash.write(SPI0_BASE + 8, byte.into());
    }
    flash.set_cs(false);
}

fn command(flash: &mut SpiFlash, opcode: u8, address: usize, payload: &[u8]) {
    transfer(flash, &[6]);
    let mut bytes = vec![
        opcode,
        (address >> 16) as u8,
        (address >> 8) as u8,
        address as u8,
    ];
    bytes.extend_from_slice(payload);
    transfer(flash, &bytes);
}

fn program(flash: &mut SpiFlash, address: usize, data: &[u8]) {
    command(flash, 0x20, address, &[]);
    for (index, page) in data.chunks_exact(PAGE).enumerate() {
        command(flash, 2, address + index * PAGE, page);
        if flash.cut() {
            return;
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    let [original, out] = args.as_slice() else {
        return Err("Usage: spi-cut ORIGINAL-FLASH OUTPUT-DIRECTORY".into());
    };
    let original = fs::read(original)?;
    assert_eq!(original.len(), FLASH_SIZE);
    fs::create_dir_all(out)?;
    for chip in [FlashPart::P25q80, FlashPart::Uc25hq80] {
        let id = chip.jedec();
        let chip_id = format!("{:02x}{:02x}{:02x}", id[0], id[1], id[2]);
        for address in [APP_START, APP_END - SECTOR] {
            let end = address + SECTOR;
            let source = &original[address..end];
            let modified: Vec<_> = source.iter().map(|byte| !byte).collect();
            for cut in 1..=17 {
                let mut flash = SpiFlash::new();
                flash.load(&original);
                flash.jedec = id;
                flash.cut_at = Some(cut);
                program(&mut flash, address, &modified);
                assert!(flash.cut());
                assert_eq!(&flash.mem[..address], &original[..address]);
                assert_eq!(&flash.mem[end..], &original[end..]);
                // Independently check the modeled interrupted sector, including the half page.
                let mut torn = source.to_vec();
                if cut == 1 {
                    torn[..SECTOR / 2].fill(0xff);
                } else {
                    torn.fill(0xff);
                    let written = (cut as usize - 2) * PAGE + PAGE / 2;
                    torn[..written].copy_from_slice(&modified[..written]);
                }
                assert_eq!(&flash.mem[address..end], torn);
                if cut == 1 || cut == 2 || cut == 17 {
                    let path = Path::new(out).join(format!("{chip_id}-{address:05x}-{cut}.bin"));
                    fs::write(path, &flash.mem)?;
                }
                flash.cut_at = None;
                flash.chip_reset();
                program(&mut flash, address, source);
                assert_eq!(flash.mem, original);
            }
            println!("{chip_id} sector 0x{address:05x}: 17 cut points and full read-back verified");
        }
    }
    Ok(())
}
