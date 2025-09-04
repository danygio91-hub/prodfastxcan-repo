
"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Button } from '../ui/button';

export interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

const DashboardItem = React.forwardRef<HTMLDivElement, DashboardItemProps & React.HTMLAttributes<HTMLDivElement>>(
  ({ title, description, icon: Icon, href, className, onClick, ...rest }, ref) => {
    
    const cardClasses = cn(
        "hover:shadow-lg hover:border-primary/50 transition-shadow,border-color duration-300 group flex flex-col h-full",
        { 'cursor-pointer': !!href || !!onClick },
        className
    );

    const cardContent = (
        <>
            <CardHeader>
              <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3 text-xl font-headline">
                      <Icon className="h-6 w-6 text-primary" />
                      <span>{title}</span>
                  </CardTitle>
                   <div className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      <ArrowRight className="h-5 w-5" />
                   </div>
                </div>
            </CardHeader>
            <CardContent className="flex-grow pt-0">
                <CardDescription>{description}</CardDescription>
            </CardContent>
        </>
    );

    if (href) {
      return (
        <Link href={href} className="block h-full" {...rest}>
          <Card ref={ref} className={cardClasses}>
            {cardContent}
          </Card>
        </Link>
      );
    }
    
    return (
      <Card ref={ref} className={cardClasses} onClick={onClick} {...rest}>
        {cardContent}
      </Card>
    );
  }
);

DashboardItem.displayName = 'DashboardItem';

export default DashboardItem;
