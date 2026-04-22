import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('h5p_content')
export class ContentRecord {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  title!: string;

  @Column('text')
  mainLibrary!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
