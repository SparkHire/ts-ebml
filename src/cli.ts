#!/usr/bin/env node
/// <reference types="node"/>
/// <reference types="commander"/>
import {Decoder, Encoder, Reader, tools} from'./';
import {program} from 'commander';
import fs = require('fs');
const version = require("../package.json").version;

program
  .version(version)
  .usage("[options] <*.webm>")
  .option('-s, --seekable', 'try convert MediaRecorder WebM to seekable WebM and write buffer stdout, like `ts-ebml -s not_seekable.webm | cat > seekable.webm`')
  .option('-k, --keyframe', 'TimestampScale & Timestamp & SimpleBlock(VideoTrack && keyframe) ebml elements pass filter for thumbnails(Random Access Points)')
  //.option('-b, --bbq-sauce', 'Add bbq sauce')
  //.option('-c, --cheese [type]', 'Add the specified type of cheese [marble]', 'marble')
  .arguments('<*.webm>')
  .parse(process.argv);

const {args} = program;

if(args.length < 1){ process.exit(); }

const opts = program.opts();

if(opts.seekable){
  const decoder = new Decoder();
  const reader = new Reader();
  reader.logging = false;
  reader.drop_default_duration = false;
  const buf = fs.readFileSync(args[0]);
  const elms = decoder.decode(buf);
  elms.forEach((elm)=>{ reader.read(elm); });
  reader.stop();
  const refinedMetadataBuf = tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues);
  const body = buf.slice(reader.metadataSize);
  const refined = new Buffer(tools.concat([new Buffer(refinedMetadataBuf), body]).buffer);
  process.stdout.write(refined);
}else if(opts.keyframe){
  const decoder = new Decoder();
  let TrackType = -1;
  let TrackNumber = -1;
  let CodecID = "";
  const trackTypes = {} as {[TrackNumber: number]: {TrackType: number, CodecID: string }};
  fs.createReadStream(args[0]).on('data', (buf: Buffer)=>{
    const ebmlElms = decoder.decode(buf);
    ebmlElms.forEach((elm)=>{
      if(elm.type === "m" && elm.name === "TrackEntry" && elm.isEnd){
        trackTypes[TrackNumber] = {TrackType, CodecID};
        TrackType = -1;
        TrackNumber = -1;
        CodecID = "";
      }else if(elm.type === "u" && elm.name === "TrackType"){
        TrackType = elm.value;
      }else if(elm.type === "u" && elm.name === "TrackNumber"){
        TrackNumber = elm.value;
      }else if(elm.type === "s" && elm.name === "CodecID"){
        CodecID = elm.value;
      }else if(elm.type === "u" && elm.name === "TimestampScale"){
        process.stdout.write(new Buffer(new Encoder().encode([elm])));
      }else if(elm.type === "u" && elm.name === "Timestamp"){
        process.stdout.write(new Buffer(new Encoder().encode([elm])));
      }else if(elm.type === "b" && elm.name === "SimpleBlock"){
        const o = tools.ebmlBlock(elm.data);
        const {TrackType:type, CodecID:id} = trackTypes[o.trackNumber];
        // 1 means video
        if(type === 1 && o.keyframe && (id === "V_VP9" || id === "V_VP8") ){
          process.stdout.write(new Buffer(new Encoder().encode([elm])));
        }
      }
    });
  });
}else{
  const decoder = new Decoder();
  fs.createReadStream(args[0]).on('data', (buf: Buffer)=>{
    // put ebml info
    const ebmlElms = decoder.decode(buf);
    ebmlElms.forEach((elm)=>{
      const {name, type, tagStart, level} = elm;
      if(elm.type === "m"){
        if(!elm.isEnd){
          console.log(`${tagStart}\t${type}\t${level}\t${name}`);
        }
      }else{
        if(elm.type === "b"){
          if(elm.name === "SimpleBlock"){
            const {discardable, frames, invisible, keyframe, timecode: timestamp, trackNumber} = tools.ebmlBlock(elm.value);
            console.log(`${tagStart}\t${type}\t${level}\t${name}`, `track:${trackNumber} timestamp:${timestamp}\tkeyframe:${keyframe}\tinvisible:${invisible}\tdiscardable:${discardable}\tlacying:${frames.length}`);
          }else{
            console.log(`${tagStart}\t${type}\t${level}\t${name}`, `<Buffer ${elm.value.byteLength}>`);
          }
        }else if(elm.type === "d"){
          console.log(`${tagStart}\t${type}\t${level}\t${name}`, tools.convertEBMLDateToJSDate(elm.value));
        }else{
          console.log(`${tagStart}\t${type}\t${level}\t${name}`, elm.value);
        }
      }
    });
  });
}
